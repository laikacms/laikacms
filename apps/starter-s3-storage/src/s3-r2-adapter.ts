import { HeadObjectCommand, PutObjectCommand, type PutObjectCommandInput, type S3Client } from '@aws-sdk/client-s3';

import type { MinimalR2Bucket } from '@laikacms/decap-integrations/workers';

/**
 * Wraps an S3 client to satisfy the `MinimalR2Bucket` interface that
 * `createWorkersLaika` / `createCustomLaika` accept as a "bucket".
 *
 * This is a **proof-of-concept** adapter — only `head` and `put` are
 * implemented, matching the minimal surface required by the workers preset's
 * `seedConfigOnFirstRequest` path.
 *
 * For a full-fat S3-backed `StorageRepository` (get, list, delete,
 * conditional writes, multipart, etc.) the proper fix is a first-party
 * `S3StorageRepository` adapter in `laikacms/storage-s3` — patterned after
 * `laikacms/storage-r2`. Tracked in `docs/starters.md` as a roadmap gap.
 *
 * Until then, this starter is a placeholder that **lights up writes of
 * `config.yml` but not real content reads**. Pair with `createCustomLaika`
 * + a real storage path (FS, R2, GitHub, Drizzle) until the S3 repo lands.
 */
export function createS3BucketShim(client: S3Client, bucketName: string): MinimalR2Bucket {
  return {
    async head(key) {
      try {
        return await client.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
      } catch (err) {
        if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
          return null;
        }
        throw err;
      }
    },
    async put(key, value) {
      return client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: key,
          Body: value as PutObjectCommandInput['Body'],
        }),
      );
    },
  };
}
