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
docker run -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=password couchdb
curl -u admin:password -X PUT http://localhost:5984/laikacms
cp .env.example .env   # set COUCHDB_USERNAME=admin COUCHDB_PASSWORD=password
pnpm dev
```

Open `http://localhost:3000/admin/` → write your first post → visit `http://localhost:3000/`.

## Environment variables

| Variable           | Required | Description                                                                |
| ------------------ | -------- | -------------------------------------------------------------------------- |
| `COUCHDB_URL`      | optional | CouchDB endpoint incl. db name (default: `http://localhost:5984/laikacms`) |
| `COUCHDB_USERNAME` | optional | HTTP Basic username                                                        |
| `COUCHDB_PASSWORD` | optional | HTTP Basic password                                                        |
| `COUCHDB_BEARER`   | optional | Bearer token for IBM Cloudant IAM auth (takes precedence over Basic)       |
| `PORT`             | optional | HTTP port (default: `3000`)                                                |

No credentials = CouchDB "admin party" mode (useful for local dev with no auth configured).

## Mango indexes (production)

Without indexes, CouchDB falls back to a full scan. Create these once after provisioning the
database:

```bash
# Index on parent (used by listAtomSummaries)
curl -u admin:password -X POST http://localhost:5984/laikacms/_index \
  -H 'Content-Type: application/json' \
  -d '{"index": {"fields": ["parent"]}}'

# Composite index (used by getObject probes)
curl -u admin:password -X POST http://localhost:5984/laikacms/_index \
  -H 'Content-Type: application/json' \
  -d '{"index": {"fields": ["type", "parent", "name"]}}'
```

## IBM Cloudant

```bash
COUCHDB_URL=https://acct.cloudant.com/laikacms \
COUCHDB_BEARER=<iam-token> \
pnpm dev
```
