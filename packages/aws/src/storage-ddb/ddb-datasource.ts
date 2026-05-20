import {
  DeleteCommand,
  type DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
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

/** Persisted shape of a single row — files store content + extension, folders are markers only. */
export interface StorageItem {
  readonly type: 'file' | 'folder';
  /** Basename within the parent folder. Files include their extension; folders do not. */
  readonly name: string;
  readonly parentKey: string;
  readonly content?: string;
  readonly extension?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Opaque per-write tag — exposed to callers as `metadata.revisionId`. */
  readonly etag: string;
}

/** Configuration for a {@link DdbStorageDataSource}. */
export interface DdbStorageDataSourceOptions {
  readonly docClient: DynamoDBDocumentClient;
  readonly tableName: string;
  /**
   * Logical prefix for the partition key. Defaults to `STORAGE#`. Set this if
   * multiple Laika tenants share the same table.
   */
  readonly partitionPrefix?: string;
  /** Override the partition key attribute name. Defaults to `PK`. */
  readonly pkAttribute?: string;
  /** Override the sort key attribute name. Defaults to `SK`. */
  readonly skAttribute?: string;
  /** Available serializer extensions — used for the "find an existing object" probe. */
  readonly availableExtensions: readonly string[];
}

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** Split a key into its parent folder path and basename. */
export const splitKey = (key: string): { parent: string; name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/** Recognise a "not found" error from DynamoDB. */
const isNotFound = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false;
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e.name === 'ResourceNotFoundException' || e.$metadata?.httpStatusCode === 404;
};

/** Map a DynamoDB SDK error onto a Laika error. */
const mapError = (error: unknown, context: string) => {
  if (isNotFound(error)) return new NotFoundError(`DynamoDB resource not found: ${context}`, { cause: error });
  if (typeof error === 'object' && error !== null) {
    const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (e.name === 'ProvisionedThroughputExceededException' || e.name === 'ThrottlingException') {
      return new TooManyRequestsError(`DynamoDB throttled: ${context}`, { cause: error });
    }
    const status = e.$metadata?.httpStatusCode;
    if (status === 401) return new AuthenticationError(`DynamoDB authentication failed: ${context}`, { cause: error });
    if (status === 403) return new ForbiddenError(`DynamoDB access denied: ${context}`, { cause: error });
    if (status !== undefined && status >= 500) {
      return new ServiceUnavailableError(`DynamoDB returned HTTP ${status}: ${context}`, { cause: error });
    }
  }
  return new InternalError(`DynamoDB operation failed: ${context}`, { cause: error });
};

const DEFAULT_PARTITION_PREFIX = 'STORAGE#';
const DEFAULT_PK_ATTR = 'PK';
const DEFAULT_SK_ATTR = 'SK';

const TYPE_ATTR = 'Type';
const CONTENT_ATTR = 'Content';
const EXTENSION_ATTR = 'Extension';
const CREATED_AT_ATTR = 'CreatedAt';
const UPDATED_AT_ATTR = 'UpdatedAt';
const ETAG_ATTR = 'ETag';

/** Generate an opaque per-write tag. `crypto.randomUUID` is available on Node 22 + Workers + Bun + Deno. */
const newEtag = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

/**
 * Low-level DynamoDB I/O for the storage repository. Single-table design:
 * each row is one file or folder marker, keyed by `(PK = prefix + parentPath,
 * SK = basename)`. Listing a folder is a single `Query`; finding a file by
 * extension-free key is a single `Query` with `begins_with(SK, "<base>.")`,
 * then a client-side filter to the registered serializer extensions.
 */
export class DdbStorageDataSource {
  private readonly docClient: DynamoDBDocumentClient;
  private readonly tableName: string;
  private readonly partitionPrefix: string;
  private readonly pkAttr: string;
  private readonly skAttr: string;
  private readonly availableExtensions: readonly string[];

  constructor(options: DdbStorageDataSourceOptions) {
    this.docClient = options.docClient;
    this.tableName = options.tableName;
    this.partitionPrefix = options.partitionPrefix ?? DEFAULT_PARTITION_PREFIX;
    this.pkAttr = options.pkAttribute ?? DEFAULT_PK_ATTR;
    this.skAttr = options.skAttribute ?? DEFAULT_SK_ATTR;
    this.availableExtensions = options.availableExtensions;
  }

  private pk(parentKey: string): string {
    return `${this.partitionPrefix}${trimSlashes(parentKey)}`;
  }

  private rowToItem(row: Record<string, unknown>): StorageItem | null {
    const type = row[TYPE_ATTR];
    if (type !== 'file' && type !== 'folder') return null;
    const skRaw = row[this.skAttr];
    const pkRaw = row[this.pkAttr];
    if (typeof skRaw !== 'string' || typeof pkRaw !== 'string') return null;
    const parentKey = pkRaw.startsWith(this.partitionPrefix)
      ? pkRaw.slice(this.partitionPrefix.length)
      : pkRaw;
    return {
      type,
      name: skRaw,
      parentKey,
      content: typeof row[CONTENT_ATTR] === 'string' ? (row[CONTENT_ATTR] as string) : undefined,
      extension: typeof row[EXTENSION_ATTR] === 'string' ? (row[EXTENSION_ATTR] as string) : undefined,
      createdAt: typeof row[CREATED_AT_ATTR] === 'string' ? (row[CREATED_AT_ATTR] as string) : new Date(0).toISOString(),
      updatedAt: typeof row[UPDATED_AT_ATTR] === 'string' ? (row[UPDATED_AT_ATTR] as string) : new Date(0).toISOString(),
      etag: typeof row[ETAG_ATTR] === 'string' ? (row[ETAG_ATTR] as string) : '',
    };
  }

  /** Lookup a single item by (parentKey, name). Returns `null` for a 404. */
  async getItem(parentKey: string, name: string): Promise<LaikaResult<StorageItem | null>> {
    try {
      const out = await this.docClient.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { [this.pkAttr]: this.pk(parentKey), [this.skAttr]: name },
        }),
      );
      if (!out.Item) return Result.succeed(null);
      const item = this.rowToItem(out.Item);
      return Result.succeed(item);
    } catch (error) {
      return Result.fail(mapError(error, `${parentKey}/${name}`));
    }
  }

  /**
   * Probe each registered extension for an extension-free key. One `Query`
   * scans `begins_with(SK, "<base>.")` against the parent partition and the
   * caller picks the first hit whose extension is registered.
   */
  async findFile(
    parentKey: string,
    baseName: string,
  ): Promise<LaikaResult<{ item: StorageItem; extension: string } | null>> {
    try {
      const out = await this.docClient.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
          ExpressionAttributeNames: { '#pk': this.pkAttr, '#sk': this.skAttr },
          ExpressionAttributeValues: { ':pk': this.pk(parentKey), ':prefix': `${baseName}.` },
        }),
      );
      for (const row of out.Items ?? []) {
        const item = this.rowToItem(row);
        if (!item || item.type !== 'file') continue;
        const dot = item.name.lastIndexOf('.');
        if (dot <= 0) continue;
        const ext = item.name.slice(dot + 1);
        if (this.availableExtensions.includes(ext)) {
          return Result.succeed({ item, extension: ext });
        }
      }
      return Result.succeed(null);
    } catch (error) {
      return Result.fail(mapError(error, `${parentKey}/${baseName}`));
    }
  }

  /** List the direct children of a folder, paginating through `LastEvaluatedKey`. */
  async listChildren(parentKey: string): Promise<LaikaResult<StorageItem[]>> {
    try {
      const out: StorageItem[] = [];
      let exclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const response = await this.docClient.send(
          new QueryCommand({
            TableName: this.tableName,
            KeyConditionExpression: '#pk = :pk',
            ExpressionAttributeNames: { '#pk': this.pkAttr },
            ExpressionAttributeValues: { ':pk': this.pk(parentKey) },
            ExclusiveStartKey: exclusiveStartKey,
          }),
        );
        for (const row of response.Items ?? []) {
          const item = this.rowToItem(row);
          if (item) out.push(item);
        }
        exclusiveStartKey = response.LastEvaluatedKey;
      } while (exclusiveStartKey);
      return Result.succeed(out);
    } catch (error) {
      return Result.fail(mapError(error, parentKey || '<root>'));
    }
  }

  /** Write (or overwrite) a file row, ensuring every ancestor folder marker exists first. */
  async putFile(
    parentKey: string,
    name: string,
    content: string,
    extension: string,
  ): Promise<LaikaResult<StorageItem>> {
    const ensured = await this.ensureFolderChain(parentKey);
    if (Result.isFailure(ensured)) return Result.fail(ensured.failure);

    // Preserve an existing `createdAt` if we are overwriting.
    const existing = await this.getItem(parentKey, name);
    const createdAt = Result.isSuccess(existing) && existing.success?.type === 'file'
      ? existing.success.createdAt
      : new Date().toISOString();

    const item: StorageItem = {
      type: 'file',
      name,
      parentKey: trimSlashes(parentKey),
      content,
      extension,
      createdAt,
      updatedAt: new Date().toISOString(),
      etag: newEtag(),
    };
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            [this.pkAttr]: this.pk(parentKey),
            [this.skAttr]: name,
            [TYPE_ATTR]: 'file',
            [CONTENT_ATTR]: content,
            [EXTENSION_ATTR]: extension,
            [CREATED_AT_ATTR]: item.createdAt,
            [UPDATED_AT_ATTR]: item.updatedAt,
            [ETAG_ATTR]: item.etag,
          },
        }),
      );
      return Result.succeed(item);
    } catch (error) {
      return Result.fail(mapError(error, `${parentKey}/${name}`));
    }
  }

  /** Idempotently write a folder marker for every ancestor of `folderKey`. */
  async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const key = trimSlashes(folderKey);
    if (key === '') return Result.succeed(undefined);
    const segments = key.split('/');
    for (let i = 0; i < segments.length; i++) {
      const parent = segments.slice(0, i).join('/');
      const name = segments[i];
      const existing = await this.getItem(parent, name);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success) continue;
      const written = await this.writeFolderMarker(parent, name);
      if (Result.isFailure(written)) return written;
    }
    return Result.succeed(undefined);
  }

  private async writeFolderMarker(parentKey: string, name: string): Promise<LaikaResult<void>> {
    const now = new Date().toISOString();
    try {
      await this.docClient.send(
        new PutCommand({
          TableName: this.tableName,
          Item: {
            [this.pkAttr]: this.pk(parentKey),
            [this.skAttr]: name,
            [TYPE_ATTR]: 'folder',
            [CREATED_AT_ATTR]: now,
            [UPDATED_AT_ATTR]: now,
            [ETAG_ATTR]: newEtag(),
          },
          ConditionExpression: 'attribute_not_exists(#sk)',
          ExpressionAttributeNames: { '#sk': this.skAttr },
        }),
      );
      return Result.succeed(undefined);
    } catch (error) {
      // ConditionalCheckFailed = the marker was concurrently written; that's fine.
      if (typeof error === 'object' && error !== null
        && (error as { name?: string }).name === 'ConditionalCheckFailedException'
      ) {
        return Result.succeed(undefined);
      }
      return Result.fail(mapError(error, `${parentKey}/${name}`));
    }
  }

  /** Delete a single row. Returns success even when the row was already gone. */
  async deleteItem(parentKey: string, name: string): Promise<LaikaResult<void>> {
    try {
      await this.docClient.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { [this.pkAttr]: this.pk(parentKey), [this.skAttr]: name },
        }),
      );
      return Result.succeed(undefined);
    } catch (error) {
      return Result.fail(mapError(error, `${parentKey}/${name}`));
    }
  }

  /** Probe whether a folder marker exists at (parentKey, name). */
  async folderExists(folderKey: string): Promise<LaikaResult<boolean>> {
    const key = trimSlashes(folderKey);
    if (key === '') return Result.succeed(true);
    const { parent, name } = splitKey(key);
    const item = await this.getItem(parent, name);
    if (Result.isFailure(item)) return Result.fail(item.failure);
    return Result.succeed(item.success?.type === 'folder');
  }

  /**
   * Diagnostic helper for tests/logging — surface the configured table /
   * partition prefix so misconfiguration is easy to spot.
   */
  describe(): { table: string; partitionPrefix: string } {
    return { table: this.tableName, partitionPrefix: this.partitionPrefix };
  }
}
