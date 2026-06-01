# starter-couchdb-blog

LaikaCMS blog starter backed by **Apache CouchDB** (`CouchDbStorageRepository` from
`@laikacms/couchdb/storage-couchdb`). Works against Apache CouchDB 3+, IBM Cloudant, and any
CouchDB-protocol-compatible store.

## Why CouchDB

Three architectural traits unique to CouchDB within the LaikaCMS backend suite:

1. **First-class `_rev` (OCC).** Every document carries an explicit revision. Updates require the
   current `_rev`; stale writes return `409 Conflict`. This is the first true optimistic-concurrency
   mechanic in the suite — every other backend either ignores concurrency or uses ETags
   informatively only.

2. **Mango selectors.** Listing content is one `POST /_find` query with a JSON selector:
   `{ "selector": { "parent": "posts", "type": "file" } }`. No SQL, no cursors.

3. **`POST /_bulk_docs` for multi-delete.** `removeAtoms(N)` costs exactly two HTTP round-trips
   regardless of N: one `/_find` to resolve `(_id, _rev)` pairs, then one `/_bulk_docs` with all
   `{ _deleted: true }` markers.

## Quick start (Docker)

```bash
pnpm couch:up     # start CouchDB container
pnpm couch:init   # create the "cms" database
pnpm couch:index  # create Mango indexes (important for performance)
cp .env.example .env
pnpm dev
```

Open `http://localhost:3000/admin` → write your first post → visit `http://localhost:3000/posts`.

## Environment variables

| Variable         | Required | Description                                                                  |
| ---------------- | -------- | ---------------------------------------------------------------------------- |
| `COUCH_URL`      | ✅       | Full database URL incl. db name, e.g. `http://admin:pass@localhost:5984/cms` |
| `COUCH_USERNAME` | optional | HTTP Basic username (if not embedded in URL)                                 |
| `COUCH_PASSWORD` | optional | HTTP Basic password (if not embedded in URL)                                 |
| `PORT`           | optional | HTTP port (default: `3000`)                                                  |

## Mango indexes (production)

Without indexes, CouchDB falls back to a full scan. Create these once:

```bash
# Index on parent (used by listAtomSummaries)
curl -X POST $COUCH_URL/_index \
  -H 'Content-Type: application/json' \
  -d '{"index": {"fields": ["parent"]}}'

# Composite index (used by getObject probes)
curl -X POST $COUCH_URL/_index \
  -H 'Content-Type: application/json' \
  -d '{"index": {"fields": ["type", "parent", "name"]}}'
```

Or run `pnpm couch:index` (uses the default dev credentials).

## Cloudant / hosted CouchDB

Set `COUCH_URL` to your Cloudant database endpoint, e.g.: `https://account.cloudant.com/cms`

For IAM auth, set `COUCH_URL` without credentials and pass the IAM token via the `auth` option in
`src/laika.ts` using `authorizationHeader: 'Bearer <token>'`.
