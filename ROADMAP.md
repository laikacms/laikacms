# Roadmap

## Current Focus

- [ ] Stable v1.0 release
- [ ] Complete test coverage
- [ ] Documentation improvements
- [ ] Convert to Effect (add helper functions to return types for non-effect consumers)
- [ ] Use effect to convert repositories so they are able to: - yield progress - yield errors
      (warnings) - yield 0, 1 or n results of a specific type - end with fatal errors - succeed with
      metadata (like pagination information)

## Planned
- [ ] More Decap CMS widgets
- [ ] Real-time collaboration
- [ ] GraphQL API option
- [ ] Capability sharing - bubble capabilities up through the chain of repositories; propagate
      capabilities via documents-api, storage-api, and assets-api to be read via proxy packages.
      _Note: Not currently necessary since Decap doesn't support paging, so everything is downloaded
      locally and capabilities like search can be done client-side. However, this is vital for
      supporting bigger datasets in the future._

## Completed

- [x] Core architecture
- [x] Cloudflare R2 support
- [x] Decap CMS backend
- [x] OAuth2 with PKCE
- [x] File sanitization
- [x] Editorial workflow
- [x] Netlify git-gateway compatible HTTP handler (`@laikacms/git-gateway`) —
      lets Decap CMS configured with `backend: git-gateway` point at a Laika
      worker without changing client config
- [x] Hosted multi-tenant gateway app (`apps/laika-gateway`) — one GitHub App
      that anyone can install on their repo; tenants point Decap at the
      gateway URL (`/github/{owner}/{repo}/api/decap`) instead of standing up
      their own Worker. Namespaced URL scheme leaves room for `/gitlab/...`
      etc. later.
- [x] WebDAV storage implementation (`laikacms/storage-webdav`) —
      runtime-agnostic `StorageRepository` backed by any RFC 4918 WebDAV
      server (Nextcloud, ownCloud, Apache `mod_dav`, `rclone serve webdav`).
      Only depends on `fetch`, so it runs on Node, Bun, Deno, Cloudflare
      Workers, and the browser.
- [x] S3 storage implementation (`@laikacms/aws/storage-s3`) — AWS SDK v3
      `S3Client`-backed `StorageRepository`, parallels `storage-r2`. Works
      against AWS S3, MinIO, LocalStack, Backblaze B2, Wasabi, DigitalOcean
      Spaces — anything that speaks the S3 API.
- [x] MeiliSearch storage implementation
      (`@laikacms/meilisearch/storage-meilisearch`) —
      `StorageRepository` over a single
      [MeiliSearch](https://www.meilisearch.com/) index. Five
      architectural traits distinguish it from Algolia (iter 11) and
      every other prior backend:
      (1) **async-by-default mutations via the Tasks API** — every
      PUT / DELETE / POST mutation returns `{taskUid, status:
      'enqueued'}`; the data source automatically polls `GET
      /tasks/{uid}` until terminal status. **First backend with this
      async-write-with-polling pattern**;
      (2) **`POST /indexes/{uid}/documents/delete-batch`** with
      primary-key array body — returns ONE task uid; the whole batch
      commits atomically once the task succeeds. **The 16th
      structurally distinct atomic-multi-write mechanism in the
      suite**: async-bulk-operation completed via task polling;
      (3) **SQL-like filter syntax** — `parent = "notes" AND type =
      "file"` (vs Algolia's Lucene-style
      `parent:"notes" AND type:"file"`);
      (4) **documents have a `primaryKey` declared at index
      creation** — the repository configures `id` as primary key
      with values like `file:notes/hello.md`;
      (5) **search via POST body** — `POST /indexes/{uid}/search`
      with `{filter, q, limit}` in JSON body, NOT URL query
      parameters. Index auto-created on first use with the right
      primary key and filterable attributes.
- [x] Backblaze B2 native storage implementation
      (`@laikacms/backblaze/storage-b2`) — `StorageRepository`
      backed by [Backblaze B2](https://www.backblaze.com/cloud-storage)
      via the **native API** (not the S3-compatible mode — that's
      covered by `@laikacms/aws/storage-s3`). Five wire-format
      traits distinguish it from every prior backend, including
      every S3-shaped object store already in the suite:
      (1) **two-phase upload pattern** — every upload requires a
      separate `b2_get_upload_url` call first, returning a fresh
      `uploadUrl` + `uploadAuthorizationToken` pair; subsequent
      `b2_upload_file` POSTs to *that* URL with *that* token, on a
      different endpoint and different lifecycle. **First backend
      with this auth pattern**;
      (2) **file versioning by default** — every upload creates a
      new version; deletes need the `(fileName, fileId)` tuple,
      not just the name. Distinct from S3-style overwrite-in-place;
      (3) **mandatory SHA-1 content verification** — uploads MUST
      include `X-Bz-Content-Sha1` header matching the actual
      content; B2 rejects mismatches at the storage layer. **First
      backend with mandatory content-hash verification on writes**.
      Hash computed via Web Crypto (`computeSha1Hex` helper
      exported);
      (4) **bare `Authorization: <token>` header** (no `Bearer`,
      no `Token`, no `Basic`). Distinct from every other auth
      header convention in the suite;
      (5) **POST-for-everything API** — even reads of metadata
      use POST with a JSON body. First backend with this
      convention. Account auth and upload URLs are cached
      automatically (~23h lifetime); re-acquisition on 503.
      `removeAtoms(N)` does N parallel `b2_delete_file_version`
      calls — B2 has no bulk-delete endpoint; not a new
      atomic-multi-write mechanism.
- [x] InfluxDB v2 storage implementation
      (`@laikacms/influxdb/storage-influxdb`) — `StorageRepository`
      backed by [InfluxDB v2](https://www.influxdata.com/) via the
      HTTP API. **First time-series backend in the suite.** Six
      wire-format traits distinguish it from every prior backend:
      (1) **line protocol writes** — newline-delimited textual format
      `measurement,tag=v field="v" timestamp_ns`. **First textual
      line-by-line write format in the suite**;
      (2) **Flux pipeline DSL for reads** — functional `|>`-piped
      expressions (`from(...) |> filter(...) |> last() |> pivot(...)`).
      **First functional pipeline DSL in the suite** — Cypher uses
      pattern-matching, EdgeQL/SurrealDB use shape literals, SQL-likes
      use SELECT/INSERT; Flux is structurally different — closer to
      LINQ or `xargs`;
      (3) **annotated CSV responses** — `#datatype` / `#group` /
      `#default` header rows precede the column-name header. **First
      CSV-on-the-wire backend**;
      (4) **tags vs fields distinction** — tags are indexed strings
      (used in filters & delete predicates); fields are arbitrary
      values. **First indexed/unindexed column distinction in the
      suite**;
      (5) **nanosecond timestamps** — `Date.now() * 1_000_000`
      precision in line protocol writes; surfaces as `revisionId` on
      reads. **First backend where `revisionId` is a sub-millisecond
      timestamp**;
      (6) **`Authorization: Token <token>` header** (literally the
      word `Token`, NOT `Bearer`). Distinct from every other auth
      header convention. Honest about the time-series shape being
      unusual for CMS — append-only storage with `|> last()` dedup
      semantics. `removeAtoms(N)` does N parallel `/api/v2/delete`
      calls (Influx v2's predicate language only supports `=`
      equality between AND'd clauses); not a new
      atomic-multi-write mechanism.
- [x] Convex storage implementation
      (`@laikacms/convex/storage-convex`) — `StorageRepository`
      backed by [Convex](https://convex.dev) via the HTTP RPC
      endpoint. **First "platform-as-API" backend** — the "query
      language" is server-side TypeScript functions defined in the
      user's Convex project; the package's value is the wire-shape
      adapter and the standardised function-contract. Five
      architectural traits distinguish it from every prior backend:
      (1) **named-function RPC as the query primitive** — wire shape
      is `POST /api/{query,mutation}` with `{path: "laika:getFile",
      args: {...}}` body. The function name travels in the body, not
      the URL. **First backend without a query DSL** (SQL/Mango/
      Cypher/etc.) — TypeScript on the Convex side IS the DSL;
      (2) **`{status: "success", value}` envelope** wrapping every
      response. **First backend with explicit success/error
      discriminator at the envelope level** (not just HTTP status);
      (3) **query / mutation / action triad** — Convex distinguishes
      pure reads, transactional writes, and side-effects at the
      endpoint level. **First backend with this read/write/side-effect
      distinction**;
      (4) **transactional mutations** — each mutation call runs as one
      transaction. `removeAtoms(N)` ships as ONE mutation call
      (`laika:removeFiles`) with the full path array; the user's
      function deletes N rows inside one transaction. Atomicity at
      the user-defined function boundary, not a new wire protocol
      mechanism — honest framing;
      (5) **per-deployment URL** — each Convex deployment is its own
      hostname; no database name in the URL. The package ships with
      a reference Convex module (`convex/laika.ts`) in the README
      that users copy into their project; function paths are
      configurable for custom layouts.
- [x] Trello storage implementation
      (`@laikacms/trello/storage-trello`) — `StorageRepository`
      over a single [Trello](https://trello.com) board. **First
      Kanban-style backend** in the suite — boards contain lists
      contain cards, and Markdown `desc` fields hold content. Five
      architectural traits distinguish it from every prior backend:
      (1) **floating-point `pos` ordering** — every card carries a
      positive-float `pos` field server-assigned for drag-and-drop
      ordering. **First backend with native positional ordering at
      the wire level**;
      (2) **`?key=…&token=…` URL-parameter authentication** —
      auth via query string, not headers. **First backend with
      query-string-based auth**;
      (3) **type-specific soft/hard delete** — lists are
      soft-deleted via `closed=true` (no physical-delete endpoint
      exists for lists); cards are physically deletable. **First
      backend with two different deletion lifecycles per resource
      type**;
      (4) **2-level platform hierarchy flattened to N-level paths**
      — deep paths encode into list names (`notes/sub/deep` → list
      `"notes/sub"` containing card `"deep.md"`); root-level files
      go to a synthesised `__root__` list. **First backend that
      flattens an arbitrary tree into a depth-limited platform**;
      (5) **`dateLastActivity` as the server-managed revision** —
      Trello updates this timestamp on every card mutation; surfaces
      as `metadata.revisionId`. **First backend using a
      server-managed change timestamp as the revision identifier**.
      Honest about what's *not* here: Trello has no bulk-delete
      endpoint, so `removeAtoms(N)` does N parallel `DELETE
      /1/cards/:id` calls — not a new atomic-multi-write mechanism.
- [x] ClickHouse storage implementation
      (`@laikacms/clickhouse/storage-clickhouse`) —
      `StorageRepository` backed by [ClickHouse](https://clickhouse.com/)
      via the HTTP interface. **First columnar OLAP backend** in the
      suite. Works against self-hosted ClickHouse, ClickHouse Cloud,
      and ClickHouse-compatible analytics engines. Four architectural
      traits distinguish it from prior SQL-ish backends:
      (1) **streaming NDJSON wire format** — `FORMAT JSONEachRow`
      returns newline-delimited JSON one row per line; INSERTs accept
      the same format in the request body. **First backend with
      streaming row-at-a-time wire format**;
      (2) **URL-as-query** — SQL travels in the URL as `?query=…`,
      NOT the body. Body is reserved for INSERT NDJSON data. **First
      backend where SQL and payload occupy different parts of the wire
      envelope**;
      (3) **`ReplacingMergeTree(version)` upsert semantics** — writes
      are INSERTs with monotonic version columns; duplicate rows are
      deduped on background merges. No conditional INSERT-or-UPDATE
      needed at the application layer (in contrast to every prior SQL
      backend's `ON CONFLICT` / `UPSERT` / `UNLESS CONFLICT` idiom);
      (4) **`FINAL` read modifier** — every SELECT uses `FINAL` to
      force merge-on-read for latest-version visibility. **First
      backend with explicit consistency-vs-performance read
      modifiers.** Honest about what's *not* here: `removeAtoms(N)`
      ships as `DELETE FROM … WHERE path IN (…) SETTINGS
      mutations_sync = 1` — same shape as Supabase PostgREST (iter
      24); not a new atomic-multi-write mechanism. The novelty is in
      the wire format and engine semantics, not in multi-write
      atomicity.
- [x] Gel (formerly EdgeDB) storage implementation
      (`@laikacms/gel/storage-gel`) — `StorageRepository` backed by
      [Gel](https://gel.com) (formerly
      [EdgeDB](https://edgedb.com)) via the HTTP EdgeQL endpoint.
      Five architectural traits distinguish it from every prior
      backend in the suite:
      (1) **EdgeQL object-shape literals** — `INSERT LaikaFile { path
      := <str>$path }` (note `:=` for assignment, `=` for equality).
      First backend with this assignment/comparison distinction at the
      wire level;
      (2) **`<type>$param` typed parameter casts** — every parameter
      declares its type in the query text itself (`<str>$path`,
      `<array<str>>$paths`), propagating to the backend planner.
      Different from libSQL's typed-object wire format and SurrealDB's
      bare `$name`;
      (3) **`FOR x IN ... UNION ( ... )` for atomic batching** —
      `removeAtoms(N)` ships as ONE `FOR p IN
      array_unpack(<array<str>>$paths) UNION (DELETE LaikaFile FILTER
      .path = p)` query. Single statement, one transaction. **The
      15th structurally distinct atomic-multi-write mechanism**;
      (4) **`UNLESS CONFLICT ON .property ELSE ( ... )`** — EdgeQL's
      UPSERT-with-fallback idiom, distinct from MERGE
      (Cypher/SurrealDB), ON CONFLICT (libSQL/Postgres), and CAS-based
      mechanisms (etcd / AT Protocol). The ELSE branch runs as the
      alternate action when the conflict fires;
      (5) **object types with links** — schema-first object-relational
      model; first object-relational backend in the suite. Type and
      module identifiers (which EdgeQL can't parameterise) are
      validated against a strict regex to prevent injection at the
      configuration layer.
- [x] Neo4j storage implementation
      (`@laikacms/neo4j/storage-neo4j`) — `StorageRepository` over
      [Neo4j](https://neo4j.com/) via the transactional HTTP endpoint
      (`POST /db/{db}/tx/commit`). Works against self-hosted Neo4j,
      AuraDB, and any HTTP-compatible Cypher endpoint. Five
      architectural traits distinguish it from every prior backend —
      including SurrealDB (graph-capable but not graph-native):
      (1) **Cypher pattern-matching DSL** — `(f:LaikaFile)`,
      `(child)-[:CHILD_OF]->(parent)` syntax with arrow-direction
      semantics;
      (2) **graph relationships as the hierarchy primitive** — files
      link to folders via `[:CHILD_OF]` edges, and folder listings are
      pattern-match traversals (`<-[:CHILD_OF]-(c)`). **First backend
      using graph traversal as a listing primitive**;
      (3) **`DETACH DELETE`** — removes node + all relationships in
      one statement; first cascading-delete primitive in the suite;
      (4) **`POST /tx/commit` with `{statements: [...]}`** — implicit
      transaction boundary at the endpoint (no `BEGIN`/`COMMIT`
      keywords like SurrealDB). `removeAtoms(N)` ships as one
      tx/commit body with N DETACH DELETE statements. **The 14th
      structurally distinct atomic-multi-write mechanism**;
      (5) **node label discrimination** — `:LaikaFile` / `:LaikaFolder`
      as first-class label tags, not `type` properties. Cypher
      injection guards on configured labels (PascalCase) and
      relationship types (UPPER_SNAKE_CASE) since labels aren't
      parameterisable in Cypher syntax.
- [x] Solid Pod / Linked Data Platform storage implementation
      (`@laikacms/solid/storage-solid`) — `StorageRepository` over a
      [Solid Pod](https://solidproject.org/) / LDP-compatible server
      (CommunitySolidServer, Inrupt's Enterprise Solid Server,
      Apache Jena Fuseki, etc.). Ships with a focused Turtle parser
      for the LDP container-listing format — no external RDF library
      needed. Five architectural traits set it apart from every prior
      backend:
      (1) **URI-as-identity** — every resource IS its URL
      (`https://alice.pod.example/laika/notes/hello.md`); no opaque
      ids, no `(table, id)` tuples;
      (2) **trailing-slash addressing** — `<pod>/notes/` (with `/`) is
      an LDP container, `<pod>/notes.md` (without) is a resource. The
      URL itself disambiguates file vs folder. First backend with this
      convention;
      (3) **RDF/Turtle wire format for container listings** — `GET
      <container/>` with `Accept: text/turtle` returns a Turtle
      document whose `ldp:contains` triples enumerate the children.
      **First triple-store / Linked Data backend in the suite**;
      (4) **content negotiation via `Accept` headers** — different
      formats per resource type (`text/markdown` for `.md`,
      `application/json` for `.json`, `text/turtle` for container
      metadata). **First content-negotiation backend**;
      (5) **`If-None-Match: *` for create-only PUTs** — HTTP
      precondition semantics as the OCC primitive (412 Precondition
      Failed → `EntryAlreadyExistsError`). First backend using HTTP
      preconditions for OCC. Honest about what's *not* here:
      LDP has no native bulk-delete primitive, so `removeAtoms(N)`
      does N parallel DELETEs. Ancestor containers are auto-created
      since LDP requires parent containers to exist before adding
      children.
- [x] LDAP storage implementation
      (`@laikacms/ldap/storage-ldap`) — `StorageRepository` over an
      LDAP directory. **Client-agnostic** — depends on a structural
      `LdapOps` interface (just five methods: `search`, `add`,
      `modify`, `del`, `bulkOps`) rather than any specific LDAP
      library, so it works with `ldapjs`, DSMLv2/HTTP gateways, or
      hand-rolled mocks. Five architectural traits distinguish it
      from every prior backend:
      (1) **DN-based hierarchical addressing** — right-to-left RDN
      order (`cn=hello.md,ou=notes,ou=cms,dc=example,dc=com`); the
      DN encodes the full path. **First backend with this addressing
      model**;
      (2) **`objectClass` schema model** — entries declare their type(s)
      as a multi-valued attribute (`laikaFile` / `laikaFolder` on top
      of `top` + `organizationalUnit`);
      (3) **LDAP search filter DSL** — `(&(objectClass=laikaFile)(|(cn=k.md)(cn=k.json)…))`
      for extension-free key resolution in **one** search call; filter
      values are escaped per RFC 4515 (`*` → `\2a`, `(` → `\28`, etc.)
      to prevent LDAP injection via filenames;
      (4) **scope-based searches** — `one`-scope against the parent OU
      gives server-side immediate-child listings (no client-side
      prefix scan needed);
      (5) **`bulkOps` as the atomic-multi-write primitive** —
      `removeAtoms(N)` ships as one bulkOps call with N `del` actions.
      **The 13th structurally distinct atomic-multi-write mechanism**.
      Ancestor OUs are auto-created when needed since LDAP requires
      parent entries to exist before adding children. The repository
      uses `organizationalUnit` as the canonical container class with
      the auxiliary `laikaFolder` so it can recognise its own folders
      vs other LDAP OUs.
- [x] SurrealDB storage implementation
      (`@laikacms/surrealdb/storage-surrealdb`) — `StorageRepository`
      backed by [SurrealDB](https://surrealdb.com/), a multi-model
      database (documents + graph + KV + relational). Four
      architectural traits set it apart from prior SQL-ish backends:
      (1) **`table:id` record identity** — record IDs are first-class
      composite handles, with safe construction via
      `type::thing("table", $path)`. Paths with slashes, dots, or any
      special characters bind without manual escaping;
      (2) **NS / DB header isolation** — namespace and database scoped
      via `NS:` / `DB:` HTTP request headers, not URL paths or query
      strings. **First backend in the suite with header-based
      tenancy**;
      (3) **`BEGIN TRANSACTION; …; COMMIT TRANSACTION;` as the atomic
      primitive** — semicolon-delimited SurQL statements wrapped in an
      explicit transaction and posted to `/sql` in a single body.
      `removeAtoms(N)` packs into one such transaction. The 12th
      structurally distinct atomic-multi-write mechanism;
      (4) **per-statement result envelopes** — every `POST /sql`
      returns an array of `{status, time, result}` entries, one per
      statement. The data source's `transaction()` helper namespaces
      variables per-statement (`$path` → `$path_0`, `$path_1`, …) to
      avoid collision in SurrealDB's global query-string vars.
      Two-table model: `laika_file` and `laika_folder`.
- [x] AT Protocol storage implementation
      (`@laikacms/atproto/storage-atproto`) — `StorageRepository` over
      an [AT Protocol](https://atproto.com/) repo on a PDS (Personal
      Data Server). Works against Bluesky's hosted PDS, self-hosted
      `pds`, and any AT Protocol-compatible host. Three architectural
      traits set it apart from everything before:
      (1) **DID-based repo identity** — the entire repo *is* a DID
      like `did:plc:abc...`; no "database name", no "bucket id";
      multi-tenancy is intrinsic. URIs use the `at://<did>/<collection>/<rkey>`
      scheme;
      (2) **content-addressable records** — every record carries a CID
      (SHA-256-based hash of the canonicalised CBOR encoding) that
      surfaces as `metadata.revisionId`. **First content-addressable
      backend in the suite** (all prior `revisionId` values were
      monotonic counters, ETags, or document revs — none were content
      hashes). Updates use the prior CID as `swapRecord` for CAS;
      (3) **`applyWrites` with discriminated-union actions** — the
      atomic multi-record write primitive takes an array tagged with
      `$type: 'com.atproto.repo.applyWrites#{create|update|delete}'`.
      `removeAtoms(N)` ships as one `applyWrites` call with N `#delete`
      actions — the 11th structurally distinct atomic-multi-write
      mechanism. rkey range scans via `[rkeyStart, rkeyEnd)` for
      prefix listing — same idiom as etcd, on the rkey alphabet.
      Two-collection model: `com.laikacms.file` and `com.laikacms.folder`.
- [x] Microsoft Graph / OneDrive storage implementation
      (`@laikacms/microsoft/storage-onedrive`) — `StorageRepository`
      backed by a OneDrive personal drive, OneDrive for Business, or a
      SharePoint document library via the
      [Microsoft Graph](https://learn.microsoft.com/en-us/graph/) API.
      Three architectural traits distinguish it from the rest:
      (1) **native path addressing** via the `/me/drive/root:/path:`
      colon-segment URL syntax — no opaque-id lookup step, and folder
      hierarchy is the real server-side structure of the drive;
      (2) **`POST /$batch` as the bulk endpoint** — up to 20
      mixed-method requests in one HTTP round-trip with optional
      `dependsOn` sequencing; `removeAtoms(N)` ships as one `$batch`
      with N `DELETE` sub-requests (chunked at 20). **The 9th
      structurally distinct atomic-multi-write mechanism in the suite**;
      (3) **pre-signed `@microsoft.graph.downloadUrl`** in metadata —
      every file response carries a short-lived public URL, so
      `getObject` does one authenticated metadata fetch + one
      unauthenticated CDN content fetch. First backend in the suite
      with **per-write conflict policy** at the API level
      (`@microsoft.graph.conflictBehavior` = `fail` / `replace` / `rename`).
- [x] libSQL / Turso storage implementation
      (`@laikacms/libsql/storage-libsql`) — `StorageRepository` backed
      by libSQL via the hrana HTTP pipeline protocol. Speaks to Turso
      Cloud, Fly libSQL, and self-hosted `sqld`. Distinct from the
      Cloudflare D1 implementation (also SQLite-over-HTTP) in two
      structural ways:
      (1) **the wire shape is `POST /v2/pipeline`** carrying N requests
      per HTTP round-trip (vs D1's one-statement `/query`);
      (2) **arguments are typed wire objects** —
      `{type: "text", value: "..."}` / `{type: "null"}` /
      `{type: "integer", value: "42"}` — not bare positional `?` params.
      Combined: `removeAtoms(N)` ships as **one** atomic `batch`
      request with N conditional `DELETE` steps (each
      `condition: {type: 'ok', step: prev}`), the **8th structurally
      distinct atomic-multi-write mechanism** in the suite. The whole
      batch rolls back if any step fails.
- [x] etcd storage implementation
      (`@laikacms/etcd/storage-etcd`) — `StorageRepository` backed by an
      [etcd](https://etcd.io/) v3 cluster via the gRPC JSON gateway.
      Three architectural traits distinguish it from everything before:
      (1) **base64-encoded keys/values on the wire** — etcd's JSON
      gateway requires `key`/`value` fields to be base64 (the gateway
      rejects raw strings with an opaque error); first backend in the
      suite with a binary-wire-format encoding step;
      (2) **prefix scans via `[key, range_end)` pairs** — no `?prefix=`
      parameter, you compute `range_end` by incrementing the last byte
      of `prefix` (`/notes/` → `/notes0`); the canonical etcd idiom,
      exposed by `prefixRangeEnd()` for app code;
      (3) **`Txn` as the atomic primitive** — `createObject` uses CAS
      (`compare: createRevision == 0` + `success: [requestPut]`),
      `removeAtoms(N)` packs N `requestDeleteRange` ops into one
      `Txn.success` array (7th structurally distinct atomic-multi-write
      mechanism in the suite). Real MVCC revisions (`mod_revision`)
      surface as `metadata.revisionId`. Key layout encodes type as
      a path segment (`/f/` vs `/d/`) so files and folders never collide.
- [x] MongoDB storage implementation
      (`@laikacms/mongodb/storage-mongodb`) — `StorageRepository` over a
      single MongoDB collection. **Driver-agnostic** — depends on a
      structural `MongoCollectionLike` interface (just six methods)
      rather than the official `mongodb` driver, so it works with any
      client (native driver, Atlas Data API shim, hand-rolled mock).
      Distinguishing trait: **aggregation pipeline as the listing DSL**
      — `aggregate([{$match: {parent}}, {$sort: {name:1}}, {$project:
      {content: 0}}])`. The `$project: {content: 0}` stage is
      load-bearing — strips the heavy body field from listings, the
      first backend to do this server-side. First staged-transformation
      query language in the suite (every prior DSL was a single
      selector expression or boolean predicate tree).
      `removeAtoms(N)` packs into one `deleteMany({_id: {$in: [...]}})`,
      atomic at the collection boundary regardless of N.
- [x] Apache CouchDB storage implementation
      (`@laikacms/couchdb/storage-couchdb`) — `StorageRepository` backed
      by [Apache CouchDB](https://couchdb.apache.org/) (also speaks to
      IBM Cloudant and any CouchDB-protocol-compatible store). Three
      traits distinguish it from everything before:
      (1) **first-class revisions** — every doc carries `_rev`, updates
      require the current rev, stale writes return a real 409 (the first
      true OCC mechanic in the suite); (2) **Mango selectors** as the
      query DSL — JSON-encoded `{selector: {parent: 'notes', type: 'file'}}`
      with `$or`/`$and`/`$in` support; (3) `POST /_bulk_docs` for atomic
      multi-document writes — `removeAtoms(N)` is **two** round-trips
      regardless of N (one `_find`, one `_bulk_docs`), with per-doc
      conflict reporting in the response array. Doc-shape: files at
      `<key>.<ext>`, folders at `<key>`, both with `parent` / `name`
      / `type` fields for efficient listing.
- [x] Vercel Blob storage implementation
      (`@laikacms/vercel/storage-blob`) — `StorageRepository` backed by
      [Vercel Blob](https://vercel.com/docs/storage/vercel-blob). Two
      architectural quirks distinguish it from the S3/R2 line:
      (1) deletes go through `POST /delete` with URLs in the *body*, not
      `DELETE /<key>`, so `removeAtoms(N)` packs into **one** round-trip
      regardless of N; (2) Vercel's list endpoint has no `delimiter`
      parameter, so subfolder grouping is reconstructed client-side by
      partitioning each path's tail on `/`. `addRandomSuffix=0` is
      hard-coded on every upload so key→URL is deterministic.
      Runtime-agnostic — only depends on `fetch`.
- [x] Supabase (PostgREST) storage implementation
      (`@laikacms/supabase/storage-postgrest`) — `StorageRepository`
      backed by Supabase's auto-generated PostgREST API. Postgres-over-HTTP
      with PostgREST's operator-suffix filter DSL
      (`?Parent=eq.notes&Type=eq.file`, `?or=(Name.eq.a,Name.eq.b)`).
      `removeAtoms(N)` packs into a single `Path=in.(…)` DELETE — one
      round-trip regardless of N. Test mock ships a faithful evaluator
      for the filter subset. Same data source talks to self-hosted
      PostgREST too.
- [x] Cloudflare Images assets implementation
      (`@laikacms/cloudflare/assets-cf-images`) — `AssetsRepository`
      backed by Cloudflare Images. Sits alongside the existing
      `storage-d1` in the same package — **second dual-contract package**
      in the suite (after `@laikacms/aws`). Variants are configured
      **account-level** (not per-URL like Cloudinary's transforms) — the
      repository emits one delivery URL per configured variant name via
      the `imagedelivery.net/<accountHash>/<imageId>/<variant>` pattern.
      Cloudflare Images has no native folders, so the repository
      synthesises folder hierarchy from `/` in image ids and filters
      listings client-side after a full enumeration.
- [x] Airtable storage implementation
      (`@laikacms/airtable/storage-airtable`) — `StorageRepository`
      backed by an Airtable table. Reads use `filterByFormula` (Airtable's
      own DSL with `{Field}` braces and double-doubled `""` literal
      escaping). Writes chunk transparently around Airtable's 10-record
      batch cap — `removeAtoms(25)` ships as ⌈25/10⌉ = 3 DELETE calls.
      Test mock ships a recursive-descent parser for the formula subset
      so new query shapes surface as parser failures, not silent regressions.
- [x] Pinata (IPFS) storage implementation
      (`@laikacms/pinata/storage-ipfs`) — `StorageRepository` backed by
      IPFS via Pinata. **The first content-addressed backend** in the
      suite — CIDs are content hashes, so updates are inherently
      copy-on-write: pin new content (new CID) → unpin old. The mutable
      storage contract sits on top of Pinata's pin-metadata search
      (`metadata[name]` and `metadata[keyvalues]` operator filters). Test
      suite includes an explicit simulation of the post-update window
      where the search index shows both old and new CIDs, verifying the
      newest-by-`date_pinned` selection.
- [x] GitHub Gist storage implementation
      (`@laikacms/gist/storage-gist`) — `StorageRepository` backed by a
      single GitHub Gist. Every storage operation routes through one
      `PATCH /gists/{id}` call with the full file delta — so
      `removeAtoms(['a','b','c'])` becomes **one** atomic PATCH, not three
      sequential calls. Slashes in keys encode as `__` (GitHub forbids
      `/` in gist filenames); the `encodeGistFilename` /
      `decodeGistFilename` helpers are exported.
- [x] Hygraph storage implementation
      (`@laikacms/hygraph/storage-hygraph`) — `StorageRepository` backed
      by Hygraph (formerly GraphCMS) via the GraphQL Content API. **First
      true-GraphQL transport** in the suite — Sanity uses GROQ, this is
      standard GraphQL. Lists both files and folders in **one** GraphQL
      operation by asking for two top-level fields (`laikaObjects` +
      `laikaFolders`) in the same request — only possible because GraphQL
      lets a single query traverse multiple schema roots. Assumes
      `LaikaObject` + `LaikaFolder` content models exist on the project.
- [x] PocketBase storage implementation
      (`@laikacms/pocketbase/storage-pb`) — `StorageRepository` backed by
      [PocketBase](https://pocketbase.io). **First self-hostable
      open-source backend** in the suite; SQLite under the hood, REST +
      JWT on the wire, PocketBase's own filter mini-language for
      queries. Records live in a configurable collection (default
      `laika_storage`); the repository expects the schema to be
      provisioned ahead of time. Test suite includes a recursive-descent
      parser for the filter language to pin the exact query shapes the
      repository emits.
- [x] Sanity storage implementation (`@laikacms/sanity/storage-sanity`) —
      `StorageRepository` backed by Sanity via the Content Lake HTTP API.
      GROQ for reads, **transactional `/mutate`** for writes — deep keys +
      ancestor folder markers commit atomically in one HTTP request,
      different from every other backend in the suite which writes
      ancestor markers separately. Native optimistic concurrency via
      Sanity's `_rev`, surfaced as `metadata.revisionId` and round-tripped
      on `updateObject` as `ifRevisionID`.
- [x] S3 assets implementation (`@laikacms/aws/assets-s3`) — **second
      contract layered on the same `S3Client`** used by
      `@laikacms/aws/storage-s3`. Same bucket model, same auth, different
      Laika contract — pair them on one bucket (separated by `basePath`)
      for combined content storage + asset hosting from a single AWS
      resource. Variations are pure URL transforms (CloudFront /
      Lambda@Edge / custom CDN), zero round-trips. First demonstration of
      dual-contract support on one backend.
- [x] Cloudflare D1 storage implementation
      (`@laikacms/cloudflare/storage-d1`) — `StorageRepository` backed by
      Cloudflare D1 (managed SQLite) over its HTTP REST API. SQL at the
      edge, runs everywhere `fetch` runs. Caller provisions the schema
      via the exported `schemaDdl()` helper. Single-`LIKE` extension
      probe resolves extension-free keys in one indexed query, in
      contrast to the parallel-`EXISTS` fan-out other DB-backed backends
      use.
- [x] Bitbucket storage implementation
      (`@laikacms/bitbucket/storage-bb`) — `StorageRepository` backed by
      Bitbucket Cloud via the REST v2 API. App-password or OAuth2 auth.
      Closes the git-platform triumvirate alongside `@laikacms/github`
      and `@laikacms/gitlab`. All writes (creates, updates, deletes) go
      through Bitbucket's unified `POST /src` multipart commit endpoint,
      so the underlying data source exposes a `commit({puts, deletes})`
      call for atomic multi-file commits.
- [x] Firestore storage implementation
      (`@laikacms/firestore/storage-firestore`) — a `StorageRepository`
      backed by Firebase Firestore via the REST API. Walks Laika's
      `/`-separated keys onto Firestore's alternating
      `collection/document/collection/document` scheme: every path segment
      becomes a document, every folder owns an `items` subcollection.
      Listing a folder is one native subcollection `GET`, no prefix scan.
      Path segments are constrained to `^[A-Za-z0-9._-]+$` and rejected
      upfront with a clear error otherwise.
- [x] Notion storage implementation (`@laikacms/notion/storage-notion`)
      — a `StorageRepository` backed by Notion. Page hierarchy maps to
      storage hierarchy: pages with child pages are folders, leaf pages
      are objects, paragraph-block body is the object content.
      Instance-local path → page-id cache so repeat lookups don't re-walk.
      Honest about the trade-offs: empty folders aren't visible, plain-
      text body only, no native version counter.
- [x] Algolia storage implementation
      (`@laikacms/algolia/storage-algolia`) — a `StorageRepository`
      backed by an Algolia search index. Each record carries reserved
      `_type`, `_parent`, `_extension`, `_content` attributes so listing
      a folder becomes one filtered query
      (`filters=_parent:"<folder>"`) rather than a prefix scan — the
      single-query folder lookup is unique among the storage backends so
      far. Writes are immediately searchable through the same index.
- [x] Cloudinary assets implementation
      (`@laikacms/cloudinary/assets-cloudinary`) — the suite's first
      non-storage backend; implements `AssetsRepository`. Signed uploads
      via Web Crypto (`api_secret` never leaves the server), Admin API
      for metadata + folder ops, deterministic URL transforms make
      `getVariations` zero-cost (no API call per variant). Six default
      variations (thumbnail/small/medium/large/webp/avif) or a
      caller-supplied set. Runtime-agnostic.
- [x] Azure Blob Storage implementation
      (`@laikacms/azure/storage-blob`) — `StorageRepository` over Azure
      Blob Storage. Mirrors `@laikacms/aws/storage-s3` in shape (flat
      container, simulated `/`-delimited folders, `.keep` markers, ETag
      surfaced as `metadata.revisionId`) but consumes a small `BlobOps`
      interface fronted by the Azure SDK via `azureContainerOps()` — so
      tests can drive the repository from a plain object literal.
      Completes the AWS / GCP / Azure cloud-storage trio.
- [x] Contentful storage implementation
      (`@laikacms/contentful/storage-contentful`) — `StorageRepository`
      backed by Contentful via the Content Management API. Two-level
      mapping (`<contentTypeId>/<entryId>`); no extension hiding because
      Contentful stores structured field values, not blobs. Native
      optimistic concurrency via `sys.version` exposed as
      `metadata.revisionId`. `createFolder` idempotently creates and
      activates a content type. Runtime-agnostic.
- [x] Dropbox storage implementation (`@laikacms/dropbox/storage-dropbox`)
      — `StorageRepository` backed by Dropbox via the HTTP API v2.
      Path-addressed (no id walk like Drive), real folders, first-class
      optimistic concurrency via Dropbox `rev` exposed as
      `metadata.revisionId`. Static-token or async `tokenProvider` auth.
      Runtime-agnostic.
- [x] Upstash Redis storage implementation
      (`@laikacms/upstash/storage-redis`) — `StorageRepository` backed by
      Redis via the Upstash REST API. Edge-friendly (only depends on
      `fetch`); pipelined `EXISTS` probe resolves an extension-free key in
      a single round-trip regardless of how many serializers are registered.
      Useful as a cache-tier in front of S3/DDB or as standalone storage
      for edge-only deployments.
- [x] Google Drive storage implementation (`@laikacms/google/storage-drive`)
      — Drive REST v3 backed `StorageRepository`. Real Drive folders (no
      `.keep` placeholders), instance-local path → id cache, static-token
      or async `tokenProvider` auth. Runtime-agnostic — only depends on
      `fetch`. First export of a new `@laikacms/google` workspace package.
- [x] DynamoDB storage implementation (`@laikacms/aws/storage-ddb`) —
      `StorageRepository` over a single DynamoDB table. `PK` partitions by
      parent folder, `SK` is the basename; listing a folder is one `Query`,
      finding a file by extension-free key is one `Query` with
      `begins_with(SK, "<base>.")`. Configurable `partitionPrefix` for
      multi-tenant deployments.
- [x] GitLab storage implementation (`@laikacms/gitlab`) — REST v4 backed
      `StorageRepository` paralleling `@laikacms/github`. PAT / OAuth /
      CI-job-token auth, optimistic concurrency via `last_commit_id`,
      upsert via `POST` → `PUT` fallback. Reserves the gateway's
      `/gitlab/{owner}/{repo}/...` URL prefix. Runtime-agnostic.
