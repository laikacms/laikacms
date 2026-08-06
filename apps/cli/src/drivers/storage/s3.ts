import { R2StorageRepository } from 'laikacms/storage-r2';
import { createS3Bucket, type S3Commands } from 'laikacms/storage-s3';

import { defaultSerializerRegistry } from '../serializers.js';
import type { StorageDriver } from '../types.js';

interface S3Options {
  readonly bucket: string;
  readonly region: string;
  readonly endpoint?: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
  readonly keyPrefix?: string;
  readonly forcePathStyle?: boolean;
  readonly defaultExtension: string;
}

const readOptions = (raw: Record<string, unknown>): S3Options => {
  const bucket = typeof raw.bucket === 'string' ? raw.bucket : process.env.S3_BUCKET;
  const accessKeyId = typeof raw.accessKeyId === 'string' ? raw.accessKeyId : process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = typeof raw.secretAccessKey === 'string'
    ? raw.secretAccessKey
    : process.env.AWS_SECRET_ACCESS_KEY;
  if (!bucket) throw new Error('s3 driver: "bucket" is required (or set S3_BUCKET)');
  if (!accessKeyId) {
    throw new Error('s3 driver: "accessKeyId" is required (or set AWS_ACCESS_KEY_ID)');
  }
  if (!secretAccessKey) {
    throw new Error('s3 driver: "secretAccessKey" is required (or set AWS_SECRET_ACCESS_KEY)');
  }
  return {
    bucket,
    // `auto` is what Cloudflare R2 expects; AWS ignores it in favour of the endpoint's region.
    region: typeof raw.region === 'string' ? raw.region : (process.env.AWS_REGION ?? 'auto'),
    endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : process.env.S3_ENDPOINT,
    accessKeyId,
    secretAccessKey,
    sessionToken: typeof raw.sessionToken === 'string' ? raw.sessionToken : process.env.AWS_SESSION_TOKEN,
    keyPrefix: typeof raw.keyPrefix === 'string' ? raw.keyPrefix : undefined,
    forcePathStyle: typeof raw.forcePathStyle === 'boolean' ? raw.forcePathStyle : undefined,
    defaultExtension: typeof raw.defaultExtension === 'string' ? raw.defaultExtension : 'md',
  };
};

/**
 * Any S3-compatible object store (AWS S3, Cloudflare R2 over its S3 endpoint,
 * MinIO, …). The `@aws-sdk/client-s3` client + command classes are lazy-loaded
 * (auto-installed on demand) and fed through laikacms's built-in `createS3Bucket`
 * adapter into the `R2StorageRepository`.
 */
export const s3Driver: StorageDriver = {
  name: 's3',
  packageName: '@aws-sdk/client-s3',
  version: '^3.0.0',
  subpath: '.',
  description: 'S3-compatible object storage (AWS S3, Cloudflare R2, MinIO)',
  build(raw, mod) {
    const options = readOptions(raw);
    const S3Client = mod.S3Client as new(config: {
      region: string,
      endpoint?: string,
      forcePathStyle?: boolean,
      credentials: { accessKeyId: string, secretAccessKey: string, sessionToken?: string },
    }) => unknown;
    const client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle,
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
      },
    });
    const commands = {
      HeadObjectCommand: mod.HeadObjectCommand,
      GetObjectCommand: mod.GetObjectCommand,
      PutObjectCommand: mod.PutObjectCommand,
      DeleteObjectCommand: mod.DeleteObjectCommand,
      ListObjectsV2Command: mod.ListObjectsV2Command,
    } as S3Commands;
    const bucket = createS3Bucket({
      // `client` is an `S3ClientLike` structurally; the SDK's real client satisfies it.
      client: client as never,
      bucketName: options.bucket,
      commands,
      keyPrefix: options.keyPrefix,
    });
    // `createS3Bucket` returns an `R2BucketLike`; the R2 repo types its first arg
    // as the Cloudflare `R2Bucket` global. They're runtime-compatible — this
    // adapter exists precisely to bridge them — so cast across the nominal gap.
    return new R2StorageRepository(
      bucket as never,
      defaultSerializerRegistry,
      options.defaultExtension,
    );
  },
};
