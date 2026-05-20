---
id: ADR-001
title: Real-time Collaboration Architecture
date: 2026-05-20
status: accepted
---

# ADR-001: Real-time Collaboration Architecture

## Context

LaikaCMS is a headless CMS whose storage layer is modelled around `StorageRepository` — an abstract class whose read operations return `LaikaTask<T>` (a single-value async stream) and whose listing operations return `LaikaStream<Atom, Done>` (a multi-value async generator). Every implementation — Cloudflare R2, Node.js filesystem, libSQL/SQLite via Drizzle — conforms to the same interface. The on-wire format is JSON:API, served by `storage-api/server.ts`, which currently has no ETag or `If-Match` headers, no versioning field in `AtomBase`, and no concept of a document session.

The editorial frontend is a lightly patched fork of Decap CMS. The `laika-backend.ts` adapter translates Decap's `Implementation` interface (originally designed for Git-backed single-editor workflows) into LaikaCMS JSON:API calls. Decap has no built-in awareness of concurrent edits: two editors opening the same entry both receive independent copies; whichever saves last silently wins.

The LaikaCMS roadmap lists "Real-time collaboration" as a **planned** feature — it is not in scope for v1.0. Before the v1.0 API shapes freeze, the team should record a chosen direction so that future implementation work does not require breaking changes to the storage interface.

## Options Considered

### Option 1: CRDT (Yjs / Automerge)

**Description**

Conflict-free Replicated Data Types (CRDTs) allow multiple clients to apply edits independently and merge them automatically without a central coordinator. The leading JavaScript/TypeScript implementation is [Yjs](https://yjs.dev/), which integrates directly with the ProseMirror/Tiptap rich-text editor ecosystem. Automerge 2.x is an alternative with a simpler API but less mature editor tooling.

Under this model:

- Each `StorageObject` would carry an opaque `yjsState` binary blob alongside its existing `content` record.
- A lightweight sync server (e.g. `y-websocket` or a custom WebSocket handler at `/sync/:key`) brokers update messages between connected clients and persists the document state.
- The `laika-backend.ts` adapter would need a second code path: instead of `persistEntry` calling `PUT /objects/:key`, it would push a Yjs update and let the sync server handle persistence.
- Decap's rich-text widget (currently CodeMirror-based) would be replaced with a Tiptap editor bound to a shared Yjs document, giving live cursors and tracked changes for free.

**Pros**

- No merge conflicts: two simultaneous edits to different parts of a document auto-merge; edits to the same region produce a deterministic result.
- Offline-capable: clients accumulate updates locally and sync on reconnect.
- Live cursors and presence come essentially for free through `y-protocols/awareness`.
- Tiptap + Yjs is a well-documented, production-proven stack. Migrating Decap's rich-text widget to Tiptap is a planned LaikaCMS goal anyway (for the `decap-widget-color` / `decap-widget-slug` trajectory).
- The sync server can be stateless in terms of durable storage — it rehydrates from the `yjsState` blob stored in the `StorageObject` and keeps in-memory state only while a document has active connections.

**Cons relative to LaikaCMS's architecture**

- **`StorageRepository` must be extended.** `AtomBase` has no version field. The sync server needs either a dedicated persistence call (e.g. `persistYjsState(key, state): LaikaTask<void>`) or an out-of-band store. Neither fits the current `StorageObjectUpdate` shape without a breaking change.
- **WebSocket infrastructure required on every deployment target.** Cloudflare Workers only support WebSockets via Durable Objects (a paid add-on); R2 alone cannot host a stateful WebSocket room. Node.js filesystem deployments need a WebSocket layer in front of the existing HTTP handler. This is a significant deployment complexity increase for what is currently a simple static/edge-deployable CMS.
- **Binary CRDT state grows indefinitely** unless compacted (Yjs calls this "snapshotting"). A compaction strategy must be implemented and tested for each storage backend.
- **`LaikaStream<Atom, Done>` does not compose well with continuous push.** The current `StorageRepository` interface is pull-based (you ask for items and they stream to you). Real-time push requires a separate WebSocket/SSE channel that sits outside the existing `LaikaTask`/`LaikaStream` model — meaning a new abstraction is needed in `laikacms/core`.
- **Decap is a large, legacy React codebase.** Replacing its rich-text widget with Tiptap+Yjs is non-trivial and might require maintaining a parallel Decap build for the transition period.

**Required infrastructure changes**

1. Add `version` (ETag / vector clock) to `AtomBase` schema.
2. Add `yjsState` blob field to `StorageObject` (optional, backend-capability-flagged via `Capabilities`).
3. Add `yjsCapability` to the `Capabilities` schema so the frontend can discover whether sync is available.
4. Implement a WebSocket sync endpoint in `storage-api/server.ts` (or a sidecar service).
5. Implement `y-websocket`-compatible room persistence against each `StorageRepository` backend (R2, filesystem, libSQL).
6. Update `laika-backend.ts` to detect CRDT capability and use the Yjs path instead of `persistEntry`.

---

### Option 2: Lock-based (Pessimistic Locking)

**Description**

Before a user opens an entry for editing, the frontend acquires a short-lived exclusive lock on that `StorageObject` key. While the lock is held, other clients see the entry as read-only (or receive a warning). The editing client must refresh the lock periodically; it is released on save or explicit close. If the network drops and the lock expires, another editor may acquire it.

**Pros relative to LaikaCMS's architecture**

- **Minimal storage layer changes.** A lock is just a `StorageObject` at a well-known key (e.g. `_locks/:key`) or a new `locks` table in the libSQL backend. `StorageRepository` can model lock acquire/release as `createObject` / `removeAtoms` calls against a dedicated namespace — no new abstract methods required.
- **Preserves existing JSON:API surface.** `laika-backend.ts` calls `GET /_locks/:key` before opening the edit form and `DELETE /_locks/:key` on close. No WebSocket or SSE infrastructure is needed.
- **Simple to reason about.** Editors either have the lock or they do not. There is no merge logic, no binary state to compact, no CRDT library to learn.
- **Works on every current deployment target** — filesystem, R2, libSQL — without new infrastructure. Lock objects are just ordinary `StorageObject`s.
- **Composable with `LaikaTask`/`LaikaStream`.** Lock operations map cleanly onto single-value `LaikaTask` calls. No new core abstractions needed.

**Cons**

- **Not true real-time collaboration.** Two authors cannot edit the same document simultaneously; they must take turns. For a CMS with small editorial teams this is usually acceptable; for high-throughput newsrooms it is not.
- **Lock abandonment.** If a browser tab crashes or loses connectivity, the lock remains until its TTL expires (typically 5–15 minutes). Other editors are blocked for that window. A manual "steal lock" UI is needed.
- **No sub-document granularity.** Locking is at the `StorageObject` (document) level. Two authors wanting to update different fields of the same document still block each other.
- **TTL management complexity.** Each `StorageRepository` implementation must support lock expiry. R2 and filesystem have no native TTL; the server must run a background sweep or use a Cloudflare Durable Object timer. libSQL/Drizzle can use a `WHERE expires_at < now()` delete but needs a sweep trigger.
- **Stale UI on conflict.** Because there is no push channel, the frontend only learns a lock has been released when it polls. Unless SSE is added, "another editor just finished" notifications are delayed by the poll interval.

**Required infrastructure changes**

1. Add a `locks` namespace convention to the storage API (e.g. `GET/PUT/DELETE /storage/_locks/:key` with a `?ttl=` query parameter).
2. Implement lock-sweep background task or delegate to Cloudflare Durable Object alarms (R2 deployments).
3. Update `Capabilities` to advertise `pessimisticLocking: { supported: boolean }`.
4. Add lock-check calls to `laika-backend.ts` in the `getEntry` and `persistEntry` methods.
5. Add UI in the Decap fork to show lock status and "steal lock" affordance.

---

### Option 3: Deferred (Explicit v1.0 Out-of-Scope Decision)

**Description**

No real-time collaboration mechanism is implemented for v1.0. The last-write-wins behaviour of the current `updateObject` path is left as-is, and the storage API surface is frozen for v1.0 without versioning or locking fields. A follow-on issue (post-v1.0) will implement the chosen collaboration strategy.

However, this decision commits to two small **future-proofing guards** that prevent a breaking schema change later:

1. Reserve an optional `etag` field on `AtomBase` — schema-optional, always `undefined` in v1.0 implementations — so that future implementations can populate it without a major version bump.
2. Reserve an optional `collaborationCapability` key in the `Capabilities` schema with `supported: false` as the default, so clients can feature-detect without a version negotiation round trip.

**Pros**

- **Zero scope increase for v1.0.** The storage layer, JSON:API surface, Decap adapter, and all deployment targets remain unchanged. The engineering team can ship v1.0 on schedule.
- **No infrastructure dependency introduced.** WebSockets, Durable Objects, lock-sweep tasks — none of these are needed.
- **Avoids premature architectural commitment.** CRDTs and locking have very different implications for the storage API. Deferring keeps options open until real user feedback informs the choice.
- **Existing behaviour is already documented and expected by early adopters.** Last-write-wins is the behaviour of every Git-backed CMS (Netlify CMS, Decap, Tina) today. It is familiar and acceptable for small teams.

**Cons**

- **Two simultaneous editors will silently lose each other's work.** For anything beyond a one-person editorial workflow this is a data-integrity risk. Teams using LaikaCMS with more than one editor must establish out-of-band coordination (e.g. "ping in Slack before editing").
- **Deferred decisions tend to stay deferred.** Without a concrete follow-up issue and milestone, real-time collaboration may never ship.
- **The longer the defer, the more expensive the future migration.** If many deployment targets accumulate users before locking/CRDT is added, the migration surface (storage schema, API version, client library updates) grows.

**Required infrastructure changes**

1. Add `etag?: string` (optional, `undefined` in all v1.0 implementations) to `AtomBaseSchema`.
2. Add `collaborationCapability?: { supported: false }` to `CapabilitiesSchema`.
3. Open a follow-up issue (`LCMS-0xx: Implement real-time collaboration`) in the Issues backlog, targeting the post-v1.0 milestone.

---

## Decision

**Option 3 — Defer to post-v1.0 — is accepted.**

**Rationale:**

- LaikaCMS v1.0 is explicitly scoped to establishing a stable, deployable headless CMS core. Real-time collaboration is a "Planned" roadmap item, not a "v1.0" item. Introducing WebSocket infrastructure or a locking protocol now would delay shipping and risk destabilising the storage interface before it has stabilised.
- The two future-proofing guards (reserved `etag` field, `collaborationCapability: { supported: false }` in `Capabilities`) cost nothing at v1.0 and prevent a breaking schema change when collaboration is implemented.
- If demand for concurrent editing materialises **before** v1.0 freezes (e.g. during a pilot with a multi-editor team), the **lowest-complexity path is pessimistic locking (Option 2)**. It requires no new core abstractions, no new infrastructure on any current deployment target, and can be added as an optional capability layer on top of the existing `StorageRepository` interface without touching `LaikaTask` or `LaikaStream`.
- For the **long-term v2.0+ horizon**, CRDTs via Yjs are the best fit for rich-text editing: the Tiptap+Yjs ecosystem is mature, the Decap-to-Tiptap migration is already directionally desired, and the offline-first / no-conflict semantics are superior to locking for distributed editorial teams. However, the WebSocket infrastructure cost and the required changes to `StorageRepository` and `Capabilities` justify pushing this to a dedicated post-v1.0 milestone.

**Summary of immediate actions:**

1. Add `etag?: string` (optional) to `AtomBaseSchema` — no implementation required, just the schema field.
2. Add `collaborationCapability` to `CapabilitiesSchema` with default `{ supported: false }`.
3. Open `LCMS-0xx: Implement real-time collaboration (post-v1.0)` in the backlog with a pointer to this ADR.

## Consequences

### If this decision is followed (defer)

- The storage API surface (`AtomBase`, `Capabilities`, `StorageRepository`) gains two small reserved fields but is otherwise unchanged. All existing backend implementations continue to compile and pass tests without modification.
- `laika-backend.ts` and the Decap frontend are unchanged. Last-write-wins behaviour continues.
- A future implementer of pessimistic locking (Option 2) can add it as an optional `StorageRepository` capability without a major version bump because the `Capabilities` schema already reserves the `collaborationCapability` key.
- A future implementer of CRDT (Option 1) will need to extend `AtomBase` with a `yjsState` blob field (the reserved `etag` is not sufficient alone, but it eliminates one breaking change). They will also need to extend `StorageRepository` with new abstract methods and add a WebSocket handler to `storage-api/server.ts`.

### If the decision is revisited pre-v1.0 (adopt Option 2 — lock-based)

- A new `StorageObjectLock` type and `_locks/` namespace convention must be defined.
- `Capabilities` gains `collaborationCapability: { supported: true, strategy: 'pessimistic-locking', ttlSeconds: number }`.
- `laika-backend.ts` must call lock-acquire before rendering the edit form and lock-release on save/close.
- All deployment target implementations must handle lock TTL cleanup.

### If Option 1 (CRDT/Yjs) is adopted post-v1.0

- `StorageRepository` gains new abstract methods (`getYjsState`, `persistYjsState`) or a separate `CollaborationRepository` interface.
- `storage-api/server.ts` gains a WebSocket upgrade handler (or a sidecar `y-websocket` process).
- Each backend implementation (R2, filesystem, libSQL) must implement CRDT state storage and compaction.
- `laika-backend.ts` gains a Yjs provider initialization path.
- Decap's rich-text widget is migrated from CodeMirror to Tiptap + Yjs.
- The `Capabilities.collaborationCapability` field changes to `{ supported: true, strategy: 'crdt-yjs', syncEndpoint: string }`.
