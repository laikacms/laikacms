import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  AuthenticationError,
  ForbiddenError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
  TooManyRequestsError,
} from 'laikacms/core';
import type { Key } from 'laikacms/storage';

/** A single entry in an S3 directory listing — a regular object or a common prefix. */
export interface S3Entry {
  readonly type: 'file' | 'dir';
  readonly key: string;
}

/** Strip leading/trailing slashes from a key. */
const normalizeKey = (key: string): string => key.replace(/^\/+|\/+$/g, '');

/** Recognise a "not found" error across the various ways the S3 SDK can report one. */
const isNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  if (e.name === 'NoSuchKey' || e.name === 'NotFound') return true;
  if (e.Code === 'NoSuchKey' || e.Code === 'NotFound') return true;
  return e.$metadata?.httpStatusCode === 404;
};

/** Map an arbitrary S3 SDK error onto a Laika error, preserving the underlying cause. */
const mapS3Error = (error: unknown, context: string): InternalError | NotFoundError | ForbiddenError | AuthenticationError | TooManyRequestsError | ServiceUnavailableError => {
  if (isNotFound(error)) {
    return new NotFoundError(`S3 object not found: ${context}`, { cause: error });
  }
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = e.$metadata?.httpStatusCode;
    if (status === 401) return new AuthenticationError(`S3 authentication failed for ${context}`, { cause: error });
    if (status === 403) return new ForbiddenError(`S3 access denied for ${context}`, { cause: error });
    if (status === 429) return new TooManyRequestsError(`S3 throttled request for ${context}`, { cause: error });
    if (status !== undefined && status >= 500) {
      return new ServiceUnavailableError(`S3 returned HTTP ${status} for ${context}`, { cause: error });
    }
  }
  return new InternalError(`S3 operation failed for ${context}`, { cause: error });
};

/**
 * Low-level I/O against an S3 bucket. Mirrors {@link laikacms/storage-r2}'s
 * datasource — same simulated-folder semantics (prefix + `/` delimiter,
 * `.keep` files for empty directories) — but talks AWS SDK v3 commands
 * instead of Cloudflare's `R2Bucket` binding.
 *
 * Works against AWS S3, MinIO, LocalStack, Backblaze B2 (S3-compatible),
 * Wasabi, and any other S3-API-compatible store.
 */
export class S3DataSource {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly availableExtensions: readonly string[] = [],
    private readonly defaultFileExtension: string = '',
    /** Optional key prefix scoping every operation under a subfolder of the bucket. */
    private readonly basePath: string = '',
  ) {}

  /** Combine the optional bucket prefix with a relative key. */
  private fullKey(relativeKey: string): string {
    const base = normalizeKey(this.basePath);
    const k = normalizeKey(relativeKey);
    return base === '' ? k : k === '' ? base : `${base}/${k}`;
  }

  /** Inverse of `fullKey` — recover the caller-facing key from an S3 object key. */
  private relativeKey(fullKey: string): string {
    const base = normalizeKey(this.basePath);
    if (base === '') return fullKey;
    if (fullKey === base) return '';
    return fullKey.startsWith(`${base}/`) ? fullKey.slice(base.length + 1) : fullKey;
  }

  /** Strip any registered serializer extension from a key. */
  private stripExtension(key: Key): Key {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
  }

  /** Resolve an extension-free key to the on-bucket key (`key.ext`) that actually exists. */
  private async resolveKeyWithExtension(key: Key): Promise<string | null> {
    const base = this.stripExtension(normalizeKey(key));
    for (const ext of this.availableExtensions) {
      const candidate = this.fullKey(`${base}.${ext}`);
      const exists = await this.headObject(candidate);
      if (exists) return candidate;
    }
    return null;
  }

  /** Return the matching serializer extension for a key, or `null` when nothing exists. */
  async findExistingObjectExtension(key: Key): Promise<string | null> {
    const base = this.stripExtension(normalizeKey(key));
    for (const ext of this.availableExtensions) {
      const candidate = this.fullKey(`${base}.${ext}`);
      const exists = await this.headObject(candidate);
      if (exists) return ext;
    }
    return null;
  }

  /** Lightweight existence/metadata probe; `null` on 404. Throws on any other error. */
  private async headObject(
    fullKey: string,
  ): Promise<{ size: number; lastModified: Date; etag?: string; contentType?: string } | null> {
    try {
      const out = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: fullKey }),
      );
      return {
        size: out.ContentLength ?? 0,
        lastModified: out.LastModified ?? new Date(0),
        etag: out.ETag,
        contentType: out.ContentType,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  /** Fetch the body of an object by extension-free key. */
  async getObjectContents(
    key: string,
  ): Promise<LaikaResult<{ content: string; key: string; extension: string }>> {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      if (!resolved) return Result.fail(new NotFoundError(`S3 object not found: ${key}`));

      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: resolved }));
      const body = out.Body;
      if (!body) return Result.fail(new InternalError(`S3 returned empty body for ${resolved}`));
      const text = await (body as { transformToString(): Promise<string> }).transformToString();

      const lastDot = resolved.lastIndexOf('.');
      const extension = lastDot > 0 ? resolved.slice(lastDot + 1) : '';
      const callerKey = this.stripExtension(this.relativeKey(resolved));
      return Result.succeed({ content: text, key: callerKey, extension });
    } catch (error) {
      return Result.fail(mapS3Error(error, key));
    }
  }

  /** Metadata for an object: size, last-modified, etag, on-bucket extension. */
  async getObjectMeta(
    key: string,
  ): Promise<
    LaikaResult<{
      size: number;
      createdAt: Date;
      updatedAt: Date;
      key: string;
      extension: string;
      etag?: string;
    }>
  > {
    try {
      const resolved = await this.resolveKeyWithExtension(key);
      if (!resolved) return Result.fail(new NotFoundError(`S3 object not found: ${key}`));
      const head = await this.headObject(resolved);
      if (!head) return Result.fail(new NotFoundError(`S3 object not found: ${key}`));

      const lastDot = resolved.lastIndexOf('.');
      const extension = lastDot > 0 ? resolved.slice(lastDot + 1) : '';
      const callerKey = this.stripExtension(this.relativeKey(resolved));
      // S3 doesn't track a separate creation time; `LastModified` doubles for both.
      return Result.succeed({
        size: head.size,
        createdAt: head.lastModified,
        updatedAt: head.lastModified,
        key: callerKey,
        extension,
        etag: head.etag,
      });
    } catch (error) {
      return Result.fail(mapS3Error(error, key));
    }
  }

  /** "Folder" probe: succeed when any object exists under the prefix. */
  async getFolderMeta(key: string): Promise<LaikaResult<{ createdAt: Date; updatedAt: Date }>> {
    const prefix = this.fullKey(key);
    const search = prefix === '' ? '' : `${prefix}/`;
    try {
      const out = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: search, MaxKeys: 1 }),
      );
      const empty = (out.Contents?.length ?? 0) === 0 && (out.CommonPrefixes?.length ?? 0) === 0;
      if (empty) return Result.fail(new NotFoundError(`S3 folder not found: ${key || '<root>'}`));
      const now = new Date();
      return Result.succeed({ createdAt: now, updatedAt: now });
    } catch (error) {
      return Result.fail(mapS3Error(error, key || '<root>'));
    }
  }

  /**
   * `ListObjectsV2` with the standard `/` delimiter, paged through to
   * completion. Returns an empty array for the root of an empty bucket;
   * a non-existent prefix surfaces as a `NotFoundError` only at the
   * repository layer (this datasource just returns what S3 returned).
   */
  async listDirectory(prefix: string): Promise<LaikaResult<S3Entry[]>> {
    const normalized = this.fullKey(prefix);
    const searchPrefix = normalized === '' ? '' : `${normalized}/`;
    try {
      const entries: S3Entry[] = [];
      let continuationToken: string | undefined;

      do {
        const out: ListObjectsV2CommandOutput = await this.client.send(
          new ListObjectsV2Command({
            Bucket: this.bucket,
            Prefix: searchPrefix,
            Delimiter: '/',
            ContinuationToken: continuationToken,
          }),
        );

        for (const object of out.Contents ?? []) {
          if (!object.Key) continue;
          // Filter the placeholder `.keep` markers we emit for empty folders.
          if (object.Key.endsWith('/.keep') || object.Key === `${searchPrefix}.keep`) continue;
          entries.push({ type: 'file', key: this.relativeKey(object.Key) });
        }
        for (const common of out.CommonPrefixes ?? []) {
          if (!common.Prefix) continue;
          // Strip trailing slash; relativise against the caller's base path.
          const dirKey = this.relativeKey(common.Prefix.replace(/\/+$/, ''));
          entries.push({ type: 'dir', key: dirKey });
        }
        continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (continuationToken);

      return Result.succeed(entries);
    } catch (error) {
      return Result.fail(mapS3Error(error, prefix || '<root>'));
    }
  }

  /** `PutObject`. Always overwrites; create-only semantics live at the repository layer. */
  async createOrUpdate(
    key: string,
    content: string,
    extension: string,
  ): Promise<LaikaResult<{ key: string }>> {
    const base = this.stripExtension(normalizeKey(key));
    const withExt = extension ? `${base}.${extension}` : base;
    const fullKey = this.fullKey(withExt);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: fullKey,
          Body: content,
          ContentType: contentTypeFor(extension),
        }),
      );
      return Result.succeed({ key: base });
    } catch (error) {
      return Result.fail(mapS3Error(error, key));
    }
  }

  /** Delete by extension-free key. Yields one result per input, like the R2 datasource. */
  async *deleteObjects(keys: readonly string[]): AsyncGenerator<LaikaResult<string>> {
    for (const key of keys) {
      try {
        const resolved = await this.resolveKeyWithExtension(key);
        if (!resolved) {
          yield Result.fail(new NotFoundError(`S3 object not found: ${key}`));
          continue;
        }
        await this.client.send(
          new DeleteObjectCommand({ Bucket: this.bucket, Key: resolved }),
        );
        yield Result.succeed(this.stripExtension(this.relativeKey(resolved)));
      } catch (error) {
        yield Result.fail(mapS3Error(error, key));
      }
    }
  }

  async isFile(key: string): Promise<boolean> {
    const resolved = await this.resolveKeyWithExtension(key);
    return resolved !== null;
  }

  async isDirectory(key: string): Promise<boolean> {
    const prefix = this.fullKey(key);
    const search = prefix === '' ? '' : `${prefix}/`;
    try {
      const out = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, Prefix: search, MaxKeys: 1 }),
      );
      return (out.Contents?.length ?? 0) > 0 || (out.CommonPrefixes?.length ?? 0) > 0;
    } catch {
      return false;
    }
  }
}

/** Best-effort Content-Type for the few text serializer formats the registry ships. */
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
