---
id: ADR-008
title: SSR content access — `laika:` stays build-time; server consumers call repositories directly
date: 2026-08-10
status: proposed
---

# ADR-008: SSR content access — `laika:` stays build-time; server consumers call repositories directly

**Date:** 2026-08-10 **Status:** Proposed **Relates to:** [[ADR-006 - cms-agnostic-protocol]] (the
protocol is the seam; tooling adapts to it, not the reverse), [[ADR-003 -
repository-effect-boundary-convention]] (repositories are the callable surface)

> **Provenance note:** this ADR records a decision already taken outside the tracker (LCMS-449 Slice
> 4, issue #850 acceptance criterion 3). The decision itself — reject the shim, sanction direct
> repository calls — is settled. The rationale below is reconstructed from the code and the shape of
> the rejected proposal, so it is filed as **proposed** rather than **accepted**: the decision owner
> should confirm the reasoning matches theirs before it flips to accepted.

## Context

`@laikacms/vite-plugin` loads content through the `laika:` protocol:

```ts
import { body, title } from 'laika:doc/posts/hello';
```

This is a **build-time** mechanism. The plugin reads the item from the documents or storage
repository during the build and emits it as an ES module with one named export per field. That
design carries the plugin's whole value proposition:

- **Fully static output.** No server, no JSON:API, nothing to deploy alongside the app. The README
  calls this "the default and primary mode: a fully static, client-only build".
- **Per-field tree-shaking.** Because each field is an independent named binding, importing
  `{ title }` drops `body` from the bundle entirely.
- **Build-time failure.** A missing document or an unreadable repository fails the build, loudly,
  once — not per request, in production.

Alongside it, LCMS-449 added an opt-in **local mode** (Slice 1/3): the dev server mounts a real
JSON:API at `/__laika` so tools that need an HTTP surface (notably the Decap admin) have one while
`vite dev` is running. Local mode is dev-only and unauthenticated by design.

This left an open question for **SSR and server-rendered consumers**, who want content read _at
request time_ rather than frozen at build time. A proposal surfaced to close that gap inside the
`laika:` protocol itself:

> **The rejected proposal — the "chunk → async-fetch shim".** For SSR builds, compile the `laika:`
> chunk into an _async fetch_ through the remote repository, so that the same
> `import { title } from 'laika:doc/posts/hello'` resolves over the network at render time instead
> of being inlined at build time.

The appeal is obvious: one import syntax, works everywhere, static in a client build and live in an
SSR build.

## Decision

**Reject the shim.** The `laika:` import stays a static-compilation tool with build-time semantics
and no runtime network behaviour, in every build target including SSR.

**SSR and server consumers call LaikaCMS repositories directly during render** — the same way they
would call Contentful's SDK, or any other content API client:

```ts
// SSR route — read at request time through the repository, not through `laika:`
import { runTask } from 'laikacms/compat';

const doc = await runTask(documents.getDocument('posts/hello'));
```

Which repository sits behind that call is the consumer's choice and is already a solved problem: a
native repository for content colocated with the server, or the JSON:API proxy repository when the
content lives behind a remote LaikaCMS. Neither requires anything new from the plugin.

## Key design forks & rationale

- **Same syntax, different semantics is the core objection.** A static import that is a compile-time
  constant in one build target and a network round trip in another is the same code with a different
  failure model, latency profile, and cache story. Nothing at the call site marks the difference.
  The cost of that ambiguity lands on every reader of the code, forever, to save one import
  statement.

- **ESM named bindings are synchronous; content fetches are not.** Making the shim work means either
  top-level `await` — which makes the entire importing module graph async and infects every consumer
  — or a synchronous facade that lies about an asynchronous read. Both are worse than an explicit
  `await` at the call site.

- **Tree-shaking cannot survive the move.** Per-field named exports tree-shake precisely because the
  values are statically known. A runtime fetch retrieves the whole document and discards nothing;
  the plugin's headline benefit silently evaporates in exactly the build target where payload size
  is least visible to the developer.

- **The import syntax has nowhere to put the runtime concerns.** Request-time reads need a timeout,
  a retry policy, a cache TTL, an auth credential, and a fallback for failure. An `import` statement
  accepts none of them. A repository call accepts all of them, and already does.

- **It duplicates a capability that already exists in better shape.** Repositories are already
  directly callable, already Effect-based with a typed error channel, and already have a JSON:API
  proxy implementation for the remote case. The shim would add a second, weaker path to the same
  data whose only advantage is syntactic.

- **It drags runtime responsibilities into a build tool.** A bundler plugin that emits a network
  client owns auth, caching, and retry semantics at runtime. That is far outside
  `@laikacms/vite-plugin`'s remit and would make it the wrong kind of dependency for a server
  deployment.

- **Consistency with [[ADR-006 - cms-agnostic-protocol]].** The repositories are the seam. Tooling
  adapts to the protocol; the protocol does not grow a second personality to suit one bundler's
  ergonomics.

## Consequences

- **`@laikacms/vite-plugin` keeps a single, honest job:** static compilation of content into the
  bundle. It gains no network client, no runtime auth surface, and no SSR-specific code path.
- **SSR consumers write one explicit `await`** against a repository instead of an import. This is a
  documented pattern rather than a hidden one, and it composes with the ordinary error handling,
  caching, and revalidation the host framework already provides.
- **Content that genuinely never changes between deploys can still use `laika:` in an SSR app** —
  the build-time inline is valid in a server bundle too. The decision is about _dynamic_ reads, not
  about banning the protocol from server builds.
- **No migration.** Nothing shipped depended on the shim; it was never built.
- **The gap the proposal aimed at stays open by design.** There is no single import that is static
  in one target and live in another, and that is the intended end state, not a deferral.

## Alternatives considered

| Option                                                          | Verdict                                                                                                                                                                             |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile `laika:` to an async fetch in SSR builds (the shim)     | **Rejected** — see rationale above.                                                                                                                                                 |
| A separate `laika-live:` protocol for request-time reads        | **Rejected** — honest about the difference, but still a bundler-owned network client with no place to put timeouts, auth, or caching. All the runtime cost, most of the ambiguity.  |
| Extend local mode's JSON:API to production as the SSR data path | **Rejected** — local mode is explicitly dev-only and unauthenticated. Production SSR should use a repository (native or JSON:API proxy) with real auth, which is already available. |
| Direct repository calls during render                           | **Accepted** — no new surface, typed errors, host-framework caching, matches how every other content API is consumed.                                                               |
