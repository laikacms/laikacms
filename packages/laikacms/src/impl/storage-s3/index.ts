/**
 * Adapter that makes any S3-compatible object store look like an
 * `R2Bucket` — enough for the existing `R2StorageRepository` to use it
 * unchanged. Drop this in front of:
 *
 *   - AWS S3
 *   - Cloudflare R2 (via its S3 endpoint, when you want a Node client)
 *   - MinIO (local dev)
 *   - Backblaze B2 (S3-compatible)
 *   - DigitalOcean Spaces
 *   - Any other S3-API-shaped service
 *
 * @example
 *   import { S3Client } from '@aws-sdk/client-s3';
 *   import { createS3Bucket } from 'laikacms/storage-s3';
 *   import { R2StorageRepository } from 'laikacms/storage-r2';
 *
 *   const s3 = new S3Client({
 *     region: 'auto',
 *     endpoint: process.env.S3_ENDPOINT,
 *     credentials: {
 *       accessKeyId: process.env.S3_ACCESS_KEY!,
 *       secretAccessKey: process.env.S3_SECRET_KEY!,
 *     },
 *   });
 *
 *   const bucket = createS3Bucket({ client: s3, bucketName: 'my-content' });
 *   const storage = new R2StorageRepository(bucket, serializers, 'md');
 *
 * Note: this file has no `@laikacms/decap-integrations` dependency — it's a
 * pure storage adapter. Pair it with the lower-level `decapApi` directly
 * or with `createCustomLaika` from `@laikacms/decap-integrations/custom`.
 *
 * The peer dep on `@aws-sdk/client-s3` is OPTIONAL — only callers using S3
 * pull it in.
 */

interface S3HeadCommand {
  Bucket?: string;
  Key?: string;
}
interface S3GetCommand {
  Bucket?: string;
  Key?: string;
}
interface S3PutCommand {
  Bucket: string;
  Key: string;
  Body: string | ReadableStream | Uint8Array;
  ContentType?: string;
}
interface S3DeleteCommand {
  Bucket?: string;
  Key?: string;
}
interface S3ListCommand {
  Bucket?: string;
  Prefix?: string;
  Delimiter?: string;
  ContinuationToken?: string;
  MaxKeys?: number;
}

interface S3HeadResult {
  ContentLength?: number;
  ETag?: string;
}
interface S3GetResult {
  Body?: {
    transformToString(): Promise<string>,
  };
}
interface S3ListResult {
  Contents?: Array<{ Key?: string, Size?: number, ETag?: string }>;
  CommonPrefixes?: Array<{ Prefix?: string }>;
  NextContinuationToken?: string;
  IsTruncated?: boolean;
}

/**
 * Structural shape of the AWS SDK v3 `S3Client.send(command)` surface.
 * Using this rather than importing `@aws-sdk/client-s3` directly keeps the
 * adapter a zero-dependency module that works with any S3-shaped client
 * (the AWS SDK is the canonical one, but mock clients in tests count too).
 */
export interface S3ClientLike {
  send(command: { input: object } & object): Promise<unknown>;
}

/**
 * Constructors imported from `@aws-sdk/client-s3`. Pass them in so we don't
 * take a hard dependency on the AWS SDK:
 *
 *   import {
 *     HeadObjectCommand, GetObjectCommand, PutObjectCommand,
 *     DeleteObjectCommand, ListObjectsV2Command,
 *   } from '@aws-sdk/client-s3';
 *
 *   createS3Bucket({ client, bucketName, commands: {
 *     HeadObjectCommand, GetObjectCommand, PutObjectCommand,
 *     DeleteObjectCommand, ListObjectsV2Command,
 *   }});
 */
export interface S3Commands {
  HeadObjectCommand: new(input: S3HeadCommand) => { input: S3HeadCommand };
  GetObjectCommand: new(input: S3GetCommand) => { input: S3GetCommand };
  PutObjectCommand: new(input: S3PutCommand) => { input: S3PutCommand };
  DeleteObjectCommand: new(input: S3DeleteCommand) => { input: S3DeleteCommand };
  ListObjectsV2Command: new(input: S3ListCommand) => { input: S3ListCommand };
}

export interface CreateS3BucketOptions {
  client: S3ClientLike;
  bucketName: string;
  commands: S3Commands;
  /** Optional key prefix prepended to every operation (for multi-tenant buckets). */
  keyPrefix?: string;
}

/**
 * R2Object shape the R2StorageRepository expects from `bucket.head` and
 * `bucket.put`. We only fill in the fields it actually reads.
 */
interface R2Object {
  key: string;
  size: number;
  etag: string;
}

interface R2ObjectBody extends R2Object {
  text(): Promise<string>;
}

interface R2ListResult {
  objects: Array<R2Object>;
  delimitedPrefixes: string[];
  truncated: boolean;
  cursor?: string;
}

/**
 * The 5-method subset of R2Bucket that `R2StorageRepository` uses.
 */
export interface R2BucketLike {
  head(key: string): Promise<R2Object | null>;
  get(key: string): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value: string | ReadableStream | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options: {
    prefix?: string,
    delimiter?: string,
    cursor?: string,
    limit?: number,
  }): Promise<R2ListResult>;
}

function is404(err: unknown): boolean {
  const e = err as { name?: string, $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound'
    || e?.name === 'NoSuchKey'
    || e?.$metadata?.httpStatusCode === 404
  );
}

export function createS3Bucket(options: CreateS3BucketOptions): R2BucketLike {
  const { client, bucketName, commands, keyPrefix = '' } = options;
  const k = (key: string) => keyPrefix + key;

  return {
    async head(key) {
      try {
        const res = (await client.send(
          new commands.HeadObjectCommand({
            Bucket: bucketName,
            Key: k(key),
          }),
        )) as S3HeadResult;
        return {
          key,
          size: res.ContentLength ?? 0,
          etag: res.ETag ?? '',
        };
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async get(key) {
      try {
        const res = (await client.send(
          new commands.GetObjectCommand({
            Bucket: bucketName,
            Key: k(key),
          }),
        )) as S3GetResult & S3HeadResult;
        if (!res.Body) return null;
        const body = res.Body;
        return {
          key,
          size: res.ContentLength ?? 0,
          etag: res.ETag ?? '',
          async text() {
            return body.transformToString();
          },
        };
      } catch (err) {
        if (is404(err)) return null;
        throw err;
      }
    },

    async put(key, value, opts) {
      await client.send(
        new commands.PutObjectCommand({
          Bucket: bucketName,
          Key: k(key),
          Body: value,
          ContentType: opts?.httpMetadata?.contentType,
        }),
      );
      // R2StorageRepository ignores the returned object on put, but we
      // still synthesize one for API parity.
      return { key, size: 0, etag: '' };
    },

    async delete(key) {
      await client.send(
        new commands.DeleteObjectCommand({
          Bucket: bucketName,
          Key: k(key),
        }),
      );
    },

    async list(opts) {
      const res = (await client.send(
        new commands.ListObjectsV2Command({
          Bucket: bucketName,
          Prefix: opts.prefix ? k(opts.prefix) : keyPrefix || undefined,
          Delimiter: opts.delimiter,
          ContinuationToken: opts.cursor,
          MaxKeys: opts.limit,
        }),
      )) as S3ListResult;

      const objects: R2Object[] = (res.Contents ?? [])
        .filter(c => c.Key !== undefined)
        .map(c => ({
          key: keyPrefix ? c.Key!.slice(keyPrefix.length) : c.Key!,
          size: c.Size ?? 0,
          etag: c.ETag ?? '',
        }));

      const delimitedPrefixes: string[] = (res.CommonPrefixes ?? [])
        .filter(p => p.Prefix !== undefined)
        .map(p => (keyPrefix ? p.Prefix!.slice(keyPrefix.length) : p.Prefix!));

      return {
        objects,
        delimitedPrefixes,
        truncated: res.IsTruncated ?? false,
        cursor: res.NextContinuationToken,
      };
    },
  };
}
