import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { EtcdDataSource, EtcdStorageRepository } from '@laikacms/etcd/storage-etcd';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

/**
 * etcd (Kubernetes' backing store) as the content store for LaikaCMS.
 *
 * etcd's gRPC gateway is JSON-over-HTTP, but three traits set it apart
 * from every other backend in this repo:
 *
 *   1. Base64 wire encoding. Every `key` and `value` field is base64'd on
 *      the wire — etcd's JSON gateway rejects raw strings silently. The
 *      data source wraps every boundary crossing with b64encode/b64decode.
 *      First backend in the suite with a binary-wire-format encoding step.
 *
 *   2. Prefix range scans. There's no ?prefix= parameter. To scan
 *      everything under /laika/posts/, you compute range_end by
 *      incrementing the last byte — etcd returns [key, range_end).
 *      The prefixRangeEnd() export surfaces this idiom for app code.
 *
 *   3. Txn as the atomic primitive. createObject uses CAS
 *      (compare: createRevision == 0 → success: [requestPut]); concurrent
 *      writes are rejected at the etcd layer, not after the fact like
 *      CouchDB's OCC. removeAtoms(N) packs N requestDeleteRange ops into
 *      one Txn — all-or-nothing, one HTTP request regardless of N.
 *
 * Required env vars:
 *   ETCD_URL   — etcd gRPC gateway endpoint (default: http://localhost:2379)
 *   ETCD_TOKEN — bearer token if auth is enabled (optional for dev)
 *
 * Quick start with Docker (Bitnami image, auth disabled):
 *   pnpm etcd:up && pnpm dev
 */

const dataSource = new EtcdDataSource({
  url: process.env['ETCD_URL'] ?? 'http://localhost:2379',
  auth: process.env['ETCD_TOKEN'] ? { token: process.env['ETCD_TOKEN'] } : undefined,
});

const storage = new EtcdStorageRepository({
  dataSource,
  basePath: '/laika',
  serializerRegistry: { md: markdownSerializer },
  defaultFileExtension: 'md',
});

export const decapConfig = minimalBlogConfig();

export const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapAdminHtml };
