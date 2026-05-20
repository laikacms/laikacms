import type { ContainerClient } from '@azure/storage-blob';
import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
  VersionMismatchError,
} from 'laikacms/core';

/** A blob's properties, kept to just the fields the repository actually consumes. */
export interface BlobProperties {
  readonly contentLength: number;
  readonly lastModified: Date;
  readonly etag: string;
  readonly contentType?: string;
}

/** A single entry yielded by hierarchy listing — either a blob or a `<prefix>/` common prefix. */
export interface BlobEntry {
  readonly kind: 'blob' | 'prefix';
  /** Full blob name or common-prefix string; includes the delimiter on prefixes. */
  readonly name: string;
}

/**
 * Minimal blob-container surface the datasource depends on. Mockable
 * directly — tests build a plain object satisfying this interface instead
 * of trying to fake the Azure SDK.
 */
export interface BlobOps {
  exists(name: string): Promise<boolean>;
  getProperties(name: string): Promise<BlobProperties | null>;
  download(name: string): Promise<string>;
  upload(name: string, content: string, contentType: string): Promise<BlobProperties>;
  delete(name: string): Promise<void>;
  listByHierarchy(prefix: string, delimiter: string): AsyncIterable<BlobEntry>;
}

/** Configuration for an {@link AzureBlobDataSource}. */
export interface AzureBlobDataSourceOptions {
  readonly ops: BlobOps;
  readonly availableExtensions: readonly string[];
  /** Optional key prefix scoping every operation under a virtual subfolder. */
  readonly basePath?: string;
}

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** Recognise Azure SDK 404s across statusCode / code shapes. */
const isAzureNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { statusCode?: number; code?: string; name?: string };
  return e.statusCode === 404 || e.code === 'BlobNotFound' || e.code === 'ContainerNotFound';
};

/** Map an Azure SDK error onto a Laika error, preserving the cause. */
const mapAzureError = (error: unknown, context: string) => {
  if (isAzureNotFound(error)) {
    return new NotFoundError(`Azure blob not found: ${context}`, { cause: error });
  }
  if (typeof error === 'object' && error !== null) {
    const e = error as { statusCode?: number; code?: string };
    if (e.statusCode === 401) return new AuthenticationError(`Azure auth failed for ${context}`, { cause: error });
    if (e.statusCode === 403) return new ForbiddenError(`Azure access denied for ${context}`, { cause: error });
    if (e.statusCode === 412 || e.code === 'ConditionNotMet') {
      return new VersionMismatchError(`Azure precondition failed for ${context}`, { cause: error });
    }
    if (e.statusCode === 429) return new TooManyRequestsError(`Azure throttled request for ${context}`, { cause: error });
    if (e.statusCode !== undefined && e.statusCode >= 500) {
      return new ServiceUnavailableError(`Azure returned HTTP ${e.statusCode} for ${context}`, { cause: error });
    }
  }
  return new InternalError(`Azure operation failed for ${context}`, { cause: error });
};

/** Drain an Azure Node readable stream into a UTF-8 string. */
const streamToText = async (stream: NodeJS.ReadableStream | undefined): Promise<string> => {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') chunks.push(Buffer.from(chunk, 'utf8'));
    else if (Buffer.isBuffer(chunk)) chunks.push(chunk);
    else chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks).toString('utf8');
};

/**
 * Adapter — wrap an Azure SDK `ContainerClient` so it satisfies {@link BlobOps}.
 * Tests don't need this; they construct a `BlobOps` directly.
 */
export const azureContainerOps = (containerClient: ContainerClient): BlobOps => ({
  async exists(name) {
    try {
      return await containerClient.getBlobClient(name).exists();
    } catch (error) {
      if (isAzureNotFound(error)) return false;
      throw error;
    }
  },
  async getProperties(name) {
    try {
      const props = await containerClient.getBlobClient(name).getProperties();
      return {
        contentLength: props.contentLength ?? 0,
        lastModified: props.lastModified ?? new Date(0),
        etag: props.etag ?? '',
        contentType: props.contentType,
      };
    } catch (error) {
      if (isAzureNotFound(error)) return null;
      throw error;
    }
  },
  async download(name) {
    const response = await containerClient.getBlobClient(name).download();
    return streamToText(response.readableStreamBody);
  },
  async upload(name, content, contentType) {
    const blockBlob = containerClient.getBlockBlobClient(name);
    const data = Buffer.from(content, 'utf8');
    const result = await blockBlob.upload(data, data.byteLength, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return {
      contentLength: data.byteLength,
      lastModified: result.lastModified ?? new Date(),
      etag: result.etag ?? '',
      contentType,
    };
  },
  async delete(name) {
    await containerClient.getBlobClient(name).deleteIfExists();
  },
  async *listByHierarchy(prefix, delimiter) {
    for await (const item of containerClient.listBlobsByHierarchy(delimiter, { prefix })) {
      yield { kind: item.kind === 'prefix' ? 'prefix' : 'blob', name: item.name };
    }
  },
});

/**
 * Low-level Azure Blob Storage I/O. Mirrors {@link laikacms/storage-r2} and
 * `@laikacms/aws/storage-s3` — same simulated-folder semantics (prefix + `/`
 * delimiter, `.keep` markers) — but speaks the {@link BlobOps} interface
 * fronted by the official Azure SDK in production.
 */
export class AzureBlobDataSource {
  private readonly ops: BlobOps;
  private readonly availableExtensions: readonly string[];
  private readonly basePath: string;

  constructor(options: AzureBlobDataSourceOptions) {
    this.ops = options.ops;
    this.availableExtensions = options.availableExtensions;
    this.basePath = options.basePath ?? '';
  }

  private fullKey(relativeKey: string): string {
    const base = trimSlashes(this.basePath);
    const k = trimSlashes(relativeKey);
    return base === '' ? k : k === '' ? base : `${base}/${k}`;
  }

  private relativeKey(fullKey: string): string {
    const base = trimSlashes(this.basePath);
    if (base === '') return fullKey;
    if (fullKey === base) return '';
    return fullKey.startsWith(`${base}/`) ? fullKey.slice(base.length + 1) : fullKey;
  }

  private stripExtension(key: string): string {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
  }

  /** Try each registered extension and return the first that exists on-bucket. */
  private async resolveKeyWithExtension(key: string): Promise<string | null> {
    const base = this.stripExtension(trimSlashes(key));
    for (const ext of this.availableExtensions) {
      const candidate = this.fullKey(`${base}.${ext}`);
      const exists = await this.ops.exists(candidate);
      if (exists) return candidate;
    }
    return null;
  }

  async findExistingObjectExtension(key: string): Promise<string | null> {
    const base = this.stripExtension(trimSlashes(key));
    for (const ext of this.availableExtensions) {
      const exists = await this.ops.exists(this.fullKey(`${base}.${ext}`));
      if (exists) return ext;
    }
    return null;
  }

  async getObjectContents(
    key: string,
  ): Promise<LaikaResult<{ content: string; key: string; extension: string }>> {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      if (!resolved) return Result.fail(new NotFoundError(`Azure blob not found: ${key}`));
      const content = await this.ops.download(resolved);
      const lastDot = resolved.lastIndexOf('.');
      const extension = lastDot > 0 ? resolved.slice(lastDot + 1) : '';
      const callerKey = this.stripExtension(this.relativeKey(resolved));
      return Result.succeed({ content, key: callerKey, extension });
    } catch (error) {
      return Result.fail(mapAzureError(error, key));
    }
  }

  async getObjectMeta(
    key: string,
  ): Promise<
    LaikaResult<{
      size: number;
      createdAt: Date;
      updatedAt: Date;
      key: string;
      extension: string;
      etag: string;
    }>
  > {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      if (!resolved) return Result.fail(new NotFoundError(`Azure blob not found: ${key}`));
      const props = await this.ops.getProperties(resolved);
      if (!props) return Result.fail(new NotFoundError(`Azure blob not found: ${key}`));
      const lastDot = resolved.lastIndexOf('.');
      const extension = lastDot > 0 ? resolved.slice(lastDot + 1) : '';
      const callerKey = this.stripExtension(this.relativeKey(resolved));
      return Result.succeed({
        size: props.contentLength,
        createdAt: props.lastModified,
        updatedAt: props.lastModified,
        key: callerKey,
        extension,
        etag: props.etag,
      });
    } catch (error) {
      return Result.fail(mapAzureError(error, key));
    }
  }

  async getFolderMeta(key: string): Promise<LaikaResult<{ createdAt: Date; updatedAt: Date }>> {
    const prefix = this.fullKey(key);
    const search = prefix === '' ? '' : `${prefix}/`;
    try {
      // Iterate the first page only — we just need to know if anything's there.
      for await (const _ of this.ops.listByHierarchy(search, '/')) {
        const now = new Date();
        return Result.succeed({ createdAt: now, updatedAt: now });
      }
      return Result.fail(new NotFoundError(`Azure folder not found: ${key || '<root>'}`));
    } catch (error) {
      return Result.fail(mapAzureError(error, key || '<root>'));
    }
  }

  async listDirectory(prefix: string): Promise<LaikaResult<BlobEntry[]>> {
    const normalized = this.fullKey(prefix);
    const searchPrefix = normalized === '' ? '' : `${normalized}/`;
    try {
      const entries: BlobEntry[] = [];
      for await (const item of this.ops.listByHierarchy(searchPrefix, '/')) {
        if (item.kind === 'blob') {
          // Filter out the `.keep` placeholders.
          if (item.name.endsWith('/.keep') || item.name === `${searchPrefix}.keep`) continue;
          entries.push({ kind: 'blob', name: this.relativeKey(item.name) });
        } else {
          const dirName = item.name.replace(/\/+$/, '');
          entries.push({ kind: 'prefix', name: this.relativeKey(dirName) });
        }
      }
      return Result.succeed(entries);
    } catch (error) {
      return Result.fail(mapAzureError(error, prefix || '<root>'));
    }
  }

  async createOrUpdate(
    key: string,
    content: string,
    extension: string,
  ): Promise<LaikaResult<{ key: string; etag: string }>> {
    const base = this.stripExtension(trimSlashes(key));
    const withExt = extension ? `${base}.${extension}` : base;
    const fullKey = this.fullKey(withExt);
    try {
      const result = await this.ops.upload(fullKey, content, contentTypeFor(extension));
      return Result.succeed({ key: base, etag: result.etag });
    } catch (error) {
      return Result.fail(mapAzureError(error, key));
    }
  }

  async *deleteObjects(keys: readonly string[]): AsyncGenerator<LaikaResult<string>> {
    for (const key of keys) {
      try {
        const resolved = await this.resolveKeyWithExtension(key);
        if (!resolved) {
          yield Result.fail(new NotFoundError(`Azure blob not found: ${key}`));
          continue;
        }
        await this.ops.delete(resolved);
        yield Result.succeed(this.stripExtension(this.relativeKey(resolved)));
      } catch (error) {
        yield Result.fail(mapAzureError(error, key));
      }
    }
  }

  async isFile(key: string): Promise<boolean> {
    return (await this.resolveKeyWithExtension(key)) !== null;
  }

  async isDirectory(key: string): Promise<boolean> {
    const prefix = this.fullKey(key);
    const search = prefix === '' ? '' : `${prefix}/`;
    try {
      for await (const _ of this.ops.listByHierarchy(search, '/')) return true;
      return false;
    } catch {
      return false;
    }
  }
}

const contentTypeFor = (extension: string): string => {
  const map: Record<string, string> = {
    json: 'application/json',
    md: 'text/markdown',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    txt: 'text/plain',
    html: 'text/html',
    xml: 'application/xml',
  };
  return map[extension] ?? 'application/octet-stream';
};
