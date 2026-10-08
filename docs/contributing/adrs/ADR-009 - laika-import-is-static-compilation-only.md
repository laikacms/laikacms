---
id: ADR-009
title: "laika: import is static-compilation only — no SSR async-fetch shim"
date: 2026-10-08
status: accepted
---

# ADR-009: `laika:` import is static-compilation only — no SSR async-fetch shim

**Date:** 2026-10-08 **Status:** Accepted **Deciders:** LaikaCMS maintainers

## Context

The `@laikacms/vite-plugin` resolves `laika:doc/<key>` and `laika:store/<key>` imports by reading
the content repository at **Vite build time** and emitting each item as a static ES module. This is
the default and primary mode.

During planning for local mode (LCMS-449, GitHub #847–#850), a variant was considered: compile a
`laika:` import into an **async fetch** against the remote repository at SSR runtime — so that a
server-side renderer (Next.js, Nuxt, SvelteKit, Astro SSR, etc.) could import content through the
`laika:` protocol during each request and have it resolved live from the storage backend.

This ADR records the decision to **reject** that variant.

## The rejected approach

The shim would have transformed `import { title } from 'laika:doc/posts/hello'` into a module whose
exports resolve from a `fetch()` to the remote JSON:API at SSR render time:

```ts
// hypothetical shim output (rejected)
const response = await fetch(`${remoteApiUrl}/api/documents/posts/hello`);
const { title, body } = await response.json();
export { body, title };
```

This would have let SSR consumers keep the `laika:` import surface without statically bundling
content.

## Decision

**Rejected.** The `laika:` import protocol remains a static-compilation tool only. No async-fetch
shim is introduced. The options for SSR consumers are:

1. **Call LaikaCMS repositories directly** during the render — the same way you would call
   Contentful's SDK or any other headless CMS. The repositories are Node.js-compatible and designed
   for direct server-side use. This is the sanctioned path.
2. **Use the `laika:` import statically** (the current model) for fully pre-rendered / client-only
   builds where content is bundled at build time.

## Rationale

**1. It conflates two distinct modes that exist for good reasons.** The static mode (build-time
inline) and the API mode (direct repository calls) are distinct by design: the `laika:` import
optimises for client-only or pre-rendered builds where the content fits in the bundle, and the
repository API optimises for dynamic server-side access. An SSR shim would force both roles onto a
single import syntax while delivering neither cleanly.

**2. It introduces a hidden cross-service dependency at render time.** Compiling a `laika:` import
into a fetch means every SSR render depends on the remote repository's availability, latency, and
auth. A static `laika:` import or a direct repository call both make that dependency explicit. The
shim hides it.

**3. The sanctioned path already works and needs no new mechanism.** A server component that calls
`runTask(documents.getDocument('posts/hello'))` (via `laikacms/compat`) or
`yield* documents.getDocument(...)` (inside an Effect) has the exact same capability the shim would
provide — with typed errors, tracing, and interruptibility — and the caller knows it is doing IO.

**4. Local mode (dev) solves the opposite problem.** The motivation for the shim was partly
developer experience: seeing content update live during `vite
dev`. Local mode (ADR-008, LCMS-449
Slice 1, GitHub #847) already solves this by mounting a real JSON:API under `/__laika` on the dev
server, using `resolveLaikaBackend` to switch automatically between the local and remote backends.
No fetch shim is needed for that use case either.

## Consequences

- **`laika:` stays build-time-only.** Neither `@laikacms/vite-plugin` nor any companion package
  introduces an async-fetch variant of the `laika:` import protocol.
- **SSR consumers use repositories directly.** Documentation and examples show the `runTask` /
  `collectStream` (compat) or `Effect.gen` patterns, not a `laika:` import in SSR context.
- **Local mode is the dev-experience answer.** `localApi: true` in the Vite plugin (plus
  `resolveLaikaBackend` in the admin entry) covers the dev-editing use case that a shim might
  otherwise be asked to solve. See [Local Mode Dev Editing](../../guides/decap/local-mode) and
  [Vite](../../guides/vite).
