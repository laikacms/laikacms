---
"@laikacms/convex": minor
---

New package: `@laikacms/convex`. First export `@laikacms/convex/storage-convex` — a
`StorageRepository` backed by [Convex](https://convex.dev) via the HTTP RPC endpoint. Five
architectural traits distinguish it from every prior backend: (1) **named-function RPC as the query
primitive** — the wire shape is `POST /api/{query,mutation}` with
`{path: "laika:getFile", args:
{...}}` body. The function name travels in the body, not the URL.
**First "platform-as-API" backend** — the "query language" is TypeScript on the Convex side, not
SQL/Mango/Cypher/etc.; (2) **`{status: "success", value}` envelope** wrapping every response.
**First backend with explicit success/error discriminator at the envelope level** (not just HTTP
status); (3) **query / mutation / action triad** — Convex distinguishes pure reads, transactional
writes, and side-effects at the endpoint level. First backend with this read/write/side-effect
distinction; (4) **transactional mutations** — each mutation call runs as one transaction.
`removeAtoms(N)` ships as ONE mutation call (`laika:removeFiles`) with the full path array; the
user's function deletes N rows inside one transaction. Atomicity at the function boundary, not a new
wire mechanism; (5) **per-deployment URL** — each Convex deployment is its own hostname; no database
name in the URL. The package ships with a reference Convex module (`convex/laika.ts`) in the README
that users copy into their project; function paths are configurable for custom layouts.
Runtime-agnostic — only depends on `fetch`.
