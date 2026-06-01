import { CouchDbDataSource, CouchDbStorageRepository } from '@laikacms/couchdb/storage-couchdb';
import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';

/**
 * Apache CouchDB storage for LaikaCMS.
 *
 * CouchDbDataSource wraps the CouchDB HTTP API. Three architectural traits
 * distinct from every other backend in this repo:
 *
 *   1. First-class _rev (OCC). Every document carries an explicit revision
 *      string. updateObject reads the current _rev immediately before
 *      writing; a concurrent update returns 409 Conflict, which the
 *      repository surfaces as EntryAlreadyExistsError.
 *
 *   2. Mango selectors. Listing children is one POST /_find query:
 *        { "selector": { "parent": "posts", "type": "file" } }
 *      Supports $eq, $in, $or, $regex — only equality forms are used here.
 *
 *   3. POST /_bulk_docs for multi-delete. removeAtoms(N) costs exactly two
 *      round-trips regardless of N: one POST /_find to resolve (id, rev)
 *      pairs, then one POST /_bulk_docs with all _deleted: true markers.
 *
 * Required env vars:
 *   COUCH_URL      — full database URL incl. db name, e.g.
 *                    http://admin:password@localhost:5984/cms
 *                    or https://account.cloudant.com/cms
 *   COUCH_USERNAME — HTTP Basic username (if not embedded in COUCH_URL)
 *   COUCH_PASSWORD — HTTP Basic password (if not embedded in COUCH_URL)
 *
 * Quick start with Docker:
 *   pnpm couch:up && pnpm couch:init && pnpm couch:index && pnpm dev
 */

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const couchUrl = process.env['COUCH_URL'] ?? 'http://localhost:5984/cms';

const dataSource = new CouchDbDataSource({
  url: couchUrl,
  auth: process.env['COUCH_USERNAME']
    ? {
      basic: {
        username: requireEnv('COUCH_USERNAME'),
        password: requireEnv('COUCH_PASSWORD'),
      },
    }
    : undefined,
});

const storage = new CouchDbStorageRepository({
  dataSource,
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
