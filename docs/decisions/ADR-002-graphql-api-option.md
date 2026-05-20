---
id: ADR-002
title: GraphQL API Option
date: 2026-05-20
status: rejected
---

# ADR-002: GraphQL API Option

**Date:** 2026-05-20
**Status:** Rejected (defer indefinitely)
**Deciders:** LaikaCMS core team

## Context

LaikaCMS exposes three JSON:API HTTP surfaces:

- **`storage-api`** — low-level key/value object and folder store, backed by `StorageRepository` (Cloudflare R2, Node.js filesystem, libSQL/Drizzle). Provides `atoms`, `atom-summaries`, `objects`, and atomic `operations` endpoints.
- **`documents-api`** — document lifecycle (published/unpublished/revisions), backed by `DocumentsRepository`. Provides `records`, `published`, `unpublished`, `revisions`, and atomic `operations` endpoints.
- **`assets-api`** — binary asset management, backed by `AssetsRepository`. Provides `resources` endpoints with multipart upload, metadata, URLs, and variations via JSON:API `include` parameters.

All three servers implement the same pattern: a `fetch(request: Request): Promise<Response>` function that routes on URL path and HTTP method, calls repository methods that return `LaikaTask<T>` or `LaikaStream<Atom, Done>` (Effect-based typed async streams), and serialises results to JSON:API format.

The primary editorial client is a lightly patched fork of **Decap CMS**. The `laika-backend.ts` adapter translates Decap's `Implementation` interface into LaikaCMS JSON:API calls. Decap has no knowledge of GraphQL and no plans to adopt it; GraphQL would therefore serve **non-Decap consumers only** — custom frontends, mobile apps, third-party integrations, or data pipelines that prefer a query-driven API over REST.

The ROADMAP lists "GraphQL API option" as a **Planned** feature. This ADR evaluates whether to pursue it.

## Options Considered

### Option A: Add Full GraphQL API Alongside JSON:API

Implement a `/graphql` endpoint (or a dedicated `graphql-api` package) that exposes the same domain operations as the three JSON:API servers, but via a GraphQL schema.

#### Schema generation strategy sub-options

**A1 — Code-first (Pothos / Nexus)**

Define the GraphQL schema programmatically in TypeScript. Pothos is the leading code-first library in 2026; it integrates well with Effect Schema types and can use plugins for pagination, error handling, and relay-style connections.

- Pro: Type-safe from TypeScript domain models to GraphQL types; no SDL/TypeScript sync problem.
- Pro: Pothos's `SchemaBuilder` can be shared across resolvers, making the schema extensible by plugin packages (e.g., a future `laikacms-graphql-documents` package).
- Con: Still requires manually mapping each repository method to a resolver. For three repositories with a combined ~20 distinct operations, this is ~20 resolvers plus input/output types.
- Con: Pothos adds a runtime dependency and a non-trivial learning curve for contributors unfamiliar with it.

**A2 — Schema-first (SDL + code-gen)**

Write a `.graphql` SDL file that mirrors the JSON:API surface and generate TypeScript resolver stubs with `graphql-codegen`.

- Pro: SDL is documentation-first; the schema file is readable by non-TypeScript consumers.
- Pro: `graphql-codegen` produces typed resolver interfaces, reducing boilerplate.
- Con: SDL and TypeScript domain types can drift. Every domain model change (e.g., adding `language` to a Document) requires updating the SDL, regenerating types, and updating resolvers — three touch points instead of one.
- Con: SDL files are not checked by the TypeScript compiler during development; errors surface at runtime.

#### Mapping to existing repository abstractions

`StorageRepository` and `DocumentsRepository` both return `LaikaTask<T>` (single-value async generator) and `LaikaStream<Atom, Done>` (multi-value async generator). A GraphQL resolver must return a plain `Promise<T>` or throw. The adapter shim is straightforward for single-value tasks (`firstResult(gen)` already exists in each server) but requires collecting the full stream before returning for list operations — which the JSON:API servers also do today.

Relationship traversal (e.g., `document.revisions`) would require either:

1. **Dataloader batching** — deduplicate `getDocument` calls within a single GraphQL request. Required to avoid N+1 queries when a query fetches a list of documents and their revisions. This is non-trivial to implement correctly for async-generator-based repositories.
2. **Eager joins at the repository level** — expose a new `getDocumentWithRevisions(key)` method on `DocumentsRepository`. This leaks GraphQL concerns into the domain layer.

Neither option is clean. The `LaikaTask`/`LaikaStream` abstraction was designed for pull-based, one-consumer-at-a-time access; GraphQL's field-resolution model assumes synchronous or `Promise`-based nested access, which does not compose naturally with the generator protocol.

#### Infrastructure changes required

1. New package `packages/api/graphql-api` with a GraphQL HTTP handler (e.g., using `graphql-yoga` or `@apollo/server`).
2. Schema definition for all three domain areas (storage, documents, assets) — estimated 600–1000 lines of SDL or Pothos builder code.
3. Resolver implementations for every query and mutation (~20–30 resolver functions).
4. Dataloader setup for list-plus-relationship queries.
5. Authentication middleware integration (mirrors `decap-oauth2` JWT handling).
6. Documentation and schema publishing (e.g., introspection endpoint).
7. Ongoing: every new domain model field must be added to the GraphQL schema in addition to the JSON:API serialiser.

**Pros**
- Enables custom frontends to fetch exactly the fields they need (bandwidth reduction on mobile/edge).
- GraphQL subscriptions could later power real-time updates (aligns with ADR-001 CRDT/Yjs direction).
- Familiar DX for teams already using GraphQL clients (Apollo Client, urql, URQL, TanStack Query + gql-tada).
- A single `/graphql` endpoint simplifies API discovery compared to three separate JSON:API servers.

**Cons**
- Significant implementation cost (>2 weeks of focused engineering) for a feature that serves zero current users (Decap does not speak GraphQL).
- Schema maintenance burden: every domain change requires three updates (domain model, JSON:API serialiser, GraphQL type/resolver).
- N+1 risk without Dataloader; Dataloader adds complexity that the current codebase does not have.
- GraphQL over `LaikaTask`/`LaikaStream` is an impedance mismatch; adapters add surface area for bugs.
- Cloudflare Workers / edge deployments may have bundle size constraints that a full GraphQL runtime (Apollo Server: ~150 kB; graphql-yoga: ~80 kB) could stress.
- No current consumer has requested GraphQL.

---

### Option B: Reject / Defer GraphQL Indefinitely

Make no changes to the API surface. The JSON:API servers remain the only programmatic interface. GraphQL is removed from the ROADMAP's "Planned" list and moved to a "Not currently planned" or "Under consideration" bucket, with a pointer to this ADR.

**Future-proofing guards (zero cost)**
- The `Capabilities` schema (established by ADR-001) already supports optional capability advertisement. A future GraphQL implementation could add `graphqlCapability: { supported: true, endpoint: string }` without breaking existing consumers.
- No reserved fields are required; GraphQL is purely additive.

**Pros**
- Zero scope increase. The three JSON:API servers and the repository abstractions remain stable.
- No new dependencies. Bundle size, cold-start time, and maintenance surface stay flat.
- Engineering time is freed for higher-priority roadmap items (real-time collaboration post-v1.0, Tiptap editor migration, passkey auth hardening).
- JSON:API is already a well-specified, machine-readable format that most HTTP clients can consume without a dedicated client library. Custom frontends can use JSON:API without GraphQL.
- Avoids premature commitment to a schema shape. If a GraphQL API is added later, the schema can be designed with real consumer requirements rather than mirroring the current JSON:API surface.

**Cons**
- Custom frontends must over-fetch or issue multiple requests (no field selection). For the current use case (Decap editorial UI plus small custom frontends), this is acceptable.
- Teams that strongly prefer GraphQL must either build their own BFF layer or wait.
- The "Planned" roadmap entry creates expectation that GraphQL is coming; removing it requires communicating the decision to any early adopters who may be waiting.

---

### Option C: Auto-generate GraphQL from JSON:API Routes (Hybrid)

Use a JSON:API-to-GraphQL transpiler (e.g., `json-api-to-graphql` or a custom schema generator that introspects the JSON:API endpoint definitions) to auto-generate a GraphQL schema without a hand-written resolver layer.

**Assessment**

Mature, production-ready JSON:API-to-GraphQL auto-generation libraries do not exist as of 2026. Existing tools either target specific JSON:API server frameworks (e.g., JSONAPI::Resources for Rails) or are abandoned. Building a custom generator would be equivalent in effort to Option A with the added risk of the generator becoming a maintenance burden of its own. This option is not viable and is rejected on feasibility grounds.

---

## Decision

**Option B — Reject / defer GraphQL — is accepted.**

### Rationale

1. **No current consumer.** The only editorial client (Decap CMS) communicates via JSON:API. There are no known non-Decap consumers of LaikaCMS that have requested GraphQL. Building a GraphQL API now is speculative infrastructure for a use case that has not materialised.

2. **Impedance mismatch with the domain model.** The `LaikaTask`/`LaikaStream` abstraction is a pull-based, typed async generator protocol that does not compose naturally with GraphQL's field-resolution model. Bridging the two requires Dataloader, eager joins, or adapter code that adds complexity without adding capability.

3. **Schema maintenance tripling.** Every domain model change currently requires updating the domain entity and the JSON:API serialiser. Adding GraphQL would add a third touch point (SDL or Pothos builder + resolver). Given that the domain is still evolving (the `language` field was added to `Document` recently), this overhead is premature.

4. **JSON:API is sufficient for custom frontend use cases.** JSON:API supports field selection (`fields[type]=...`), sparse fieldsets, and compound documents (`include=...`) — covering the most common reasons teams reach for GraphQL. The `assets-api` already implements `include` for metadata, URLs, and variations.

5. **Better timing post-v1.0.** Once the domain model stabilises and real non-Decap consumers appear, the GraphQL schema can be designed to match actual query patterns (not just mirror the JSON:API surface). A schema designed for real consumers will be better than one designed speculatively.

6. **Prefer Pothos if GraphQL is ever added.** If this decision is revisited, Option A1 (code-first with Pothos) is the preferred implementation path. It avoids SDL/TypeScript drift, aligns with the Effect Schema type system already in use, and keeps the schema co-located with resolver code rather than in a separate file.

### Immediate actions

1. Update `ROADMAP.md`: move "GraphQL API option" from "Planned" to "Under consideration — see ADR-002".
2. No code changes required.
3. No follow-up issue is created (decision is to not pursue; reopen as a new issue if consumer demand materialises).

## Consequences

### If this decision is followed

- The three JSON:API servers (`storage-api`, `documents-api`, `assets-api`) remain the sole programmatic API surface.
- No new dependencies are added.
- Custom frontend teams must use JSON:API or build their own BFF GraphQL layer on top of LaikaCMS JSON:API endpoints.
- When/if GraphQL is reconsidered, the chosen approach should be Pothos code-first (Option A1), the schema should cover only the endpoints required by known consumers (not a full mirror of JSON:API), and Dataloader must be implemented from day one to prevent N+1 queries.

### If this decision is revisited (adopt Option A1 — Pothos code-first)

- A new package `packages/api/graphql-api` is created.
- `StorageRepository` and `DocumentsRepository` are wrapped in a thin adapter that converts `LaikaTask<T>` / `LaikaStream<Atom, Done>` to `Promise<T>` / `Promise<T[]>` for resolver consumption.
- Dataloader instances are created per request for list + relationship queries.
- `Capabilities` gains `graphqlCapability: { supported: true, endpoint: '/graphql' }`.
- All three existing JSON:API servers remain unchanged; GraphQL is additive.
- The `graphql-yoga` runtime is preferred over Apollo Server for edge compatibility (smaller bundle, Cloudflare Workers support).
