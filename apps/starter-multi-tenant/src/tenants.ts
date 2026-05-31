import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

/**
 * One Laika instance per tenant, created lazily on first access.
 *
 * The starter uses per-tenant FileSystem dirs for the simplest possible
 * isolation: `./content/tenants/<tenantId>/`. For production at scale, swap
 * `createEmbeddedLaika({ contentDir })` for `createCustomLaika({ storage })`
 * with a shared S3 bucket and per-tenant `keyPrefix` (see `laikacms/storage-s3`):
 *
 *   const bucket = createS3Bucket({ client: s3, bucketName, commands,
 *                                    keyPrefix: `tenants/${tenantId}/` });
 *   const storage = new R2StorageRepository(bucket, serializers, 'md');
 *   const laika = createCustomLaika({ storage, decapConfig, basePath, auth });
 *
 * Same isolation guarantee, single shared object store, no per-tenant
 * volume management.
 */
type Laika = ReturnType<typeof createEmbeddedLaika>;

const cache = new Map<string, Laika>();

export function getTenantLaika(tenantId: string, basePath: string): Laika {
  const existing = cache.get(tenantId);
  if (existing) return existing;

  const laika = createEmbeddedLaika({
    contentDir: resolve(process.cwd(), 'content', 'tenants', tenantId),
    decapConfig: minimalBlogConfig(),
    basePath,
    auth: { mode: 'dev' },
  });
  cache.set(tenantId, laika);
  return laika;
}

/**
 * Demo token → tenant mapping. In production this is your auth system:
 * decode a JWT, look up the user's org, return the org ID.
 */
const TOKEN_TO_TENANT: Record<string, string> = {
  'acme-token': 'acme',
  'widgetco-token': 'widgetco',
};

export function tenantFromBearer(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authHeader);
  if (!match) return null;
  return TOKEN_TO_TENANT[match[1]!] ?? null;
}

/**
 * Alternative: tenant from subdomain (e.g. `acme.example.com`). Wire this in
 * a Hono middleware if you prefer subdomain-based routing.
 */
export function tenantFromHost(host: string | null): string | null {
  if (!host) return null;
  const sub = host.split('.')[0];
  return sub && Object.values(TOKEN_TO_TENANT).includes(sub) ? sub : null;
}
