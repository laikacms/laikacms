import { head, put } from '@vercel/blob';

import type { MinimalR2Bucket } from '@laikacms/decap-integrations/workers';

/**
 * Adapter that makes Vercel Blob look like a Cloudflare R2 bucket — enough
 * for `createWorkersLaika({ bucket: ... })` and `R2StorageRepository` to
 * accept it.
 *
 * This intentionally implements only the `head` and `put` surface used by
 * the workers preset's `seedConfigOnFirstRequest` path. The full
 * `R2StorageRepository` ALSO needs `get`, `list`, `delete`, and the
 * conditional-write primitives — which Vercel Blob does NOT support 1:1.
 * Treat this starter as a proof-of-concept; for production on Vercel,
 * use the Node runtime + FileSystem on a persistent volume, or use the
 * `@laikacms/aws` S3 adapter pattern with @aws-sdk/client-s3.
 */
export function createVercelBlobBucket(prefix = ''): MinimalR2Bucket {
  return {
    async head(key) {
      try {
        return await head(prefix + key);
      } catch (err) {
        // Vercel Blob throws on 404; treat as "not present".
        if (err instanceof Error && /not found/i.test(err.message)) return null;
        throw err;
      }
    },
    async put(key, value) {
      // Vercel's PutBody type is narrower than the web-standard set our
      // adapter accepts. The runtime accepts strings/streams/buffers fine.
      return put(prefix + key, value as Parameters<typeof put>[1], { access: 'public' });
    },
  };
}
