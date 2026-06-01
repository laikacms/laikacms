# starter-etcd-blog

LaikaCMS blog starter backed by **etcd** — Kubernetes' core backing store (`EtcdStorageRepository`
from `@laikacms/etcd/storage-etcd`). etcd is strongly consistent, MVCC, and linearisable.

## Why etcd

Three wire-format traits unique to etcd in the LaikaCMS backend suite:

1. **Base64-encoded wire format.** etcd's gRPC-gateway is JSON-over-HTTP, but every `key` and
   `value` field is base64'd. Raw strings are silently rejected. The data source transparently
   encodes/decodes every boundary crossing — first backend in the suite with this pattern.

2. **Prefix range scans.** There's no `?prefix=` parameter. To scan everything under `/laika/posts/`
   you compute `range_end` by incrementing the last byte of the prefix (`/` → `0`), then call
   `POST /v3/kv/range` with `{ key, range_end }`. The exported `prefixRangeEnd()` helper surfaces
   this idiom for app code.

3. **`Txn` as the atomic primitive.** Two distinct uses:
   - `createObject` uses genuine **compare-and-swap** — `compare: createRevision == 0` +
     `success:
     [requestPut]`. A concurrent writer loses at the etcd layer, not just after the
     fact.
   - `removeAtoms(N)` packs N `requestDeleteRange` ops into one `Txn` — all-or-nothing, one HTTP
     request regardless of N.

## Quick start (Docker)

```bash
pnpm etcd:up      # start etcd with auth disabled (dev only)
cp .env.example .env
pnpm dev
```

Open `http://localhost:3000/admin` → write a post → visit `http://localhost:3000/posts`.

## Environment variables

| Variable     | Required | Description                                         |
| ------------ | -------- | --------------------------------------------------- |
| `ETCD_URL`   | optional | gRPC gateway URL (default: `http://localhost:2379`) |
| `ETCD_TOKEN` | optional | Bearer token if etcd auth is enabled                |
| `PORT`       | optional | HTTP port (default: `3000`)                         |

## Enabling etcd auth (production)

```bash
# Create root user + root role, then enable auth
etcdctl user add root --new-user-password=<password>
etcdctl role add root
etcdctl user grant-role root root
etcdctl auth enable

# Authenticate and get a token
TOKEN=$(etcdctl --user root:<password> auth status 2>&1 | ...)
```

Then set `ETCD_TOKEN` to the token returned by `POST /v3/auth/authenticate`.

## Inspecting content

```bash
# List all keys under /laika with etcdctl
etcdctl get /laika --prefix --keys-only

# Or via the HTTP gateway (keys are base64'd in the response)
curl http://localhost:2379/v3/kv/range \
  -d '{"key": "L2xhaWth", "range_end": "L2xhaWti"}'  # base64("/laika") to base64("/laikb")
```
