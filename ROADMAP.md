# Roadmap

## Current Focus

- [ ] Stable v1.0 release
- [ ] Complete test coverage
- [ ] Documentation improvements

## Planned

- [ ] More Decap CMS widgets
- [ ] Real-time collaboration
- [ ] GraphQL API option _(under consideration — see
      [ADR-002](docs/decisions/ADR-002-graphql-api-option.md))_
- [ ] Capability sharing - bubble capabilities up through the chain of repositories; propagate
      capabilities via documents-api, storage-api, and assets-api to be read via proxy packages.
      _Note: Not currently necessary since Decap doesn't support paging, so everything is downloaded
      locally and capabilities like search can be done client-side. However, this is vital for
      supporting bigger datasets in the future._

### Recoverable-warning pipeline — follow-ups

The Effect-based warning pipeline is feature-complete (see Completed below). These items are small,
lower-priority extensions to it.

- [ ] **i18n for recoverable warning messages** — warnings currently surface as plain English
      strings from each backend. Define a translation-key convention (or attach
      `translation.message` per `LaikaError`) so the Decap UI can localise them when it gains a
      partial-success affordance.
- [ ] **`documents-jsonapi-proxy` atomic-batch warnings** — same pattern: when the proxy starts
      sending `/operations` POSTs (rather than individual HTTP calls per op), it should forward
      per-result `meta.warnings` from the upstream response.

## Completed

- [x] Core architecture
- [x] Cloudflare R2 support
- [x] Decap CMS backend
- [x] OAuth2 with PKCE
- [x] File sanitization
- [x] Editorial workflow
- [x] Effect-based repository contracts + recoverable-warning pipeline — `LaikaTask` / `LaikaStream`
      (Effect Channel-backed) carry data, recoverable warnings, progress events, and a terminal
      value/done. Every storage / documents / assets repository interface returns them;
      Promise-shaped escape hatches (`runPromise`, `runPromiseCollect`, `runPromiseResult`) keep
      non-Effect consumers ergonomic. Every in-tree backend (R2, FS, WebDAV, Drizzle, JSON:API
      proxy, contentbase, obsidian) emits recoverable warnings on partial-success paths instead of
      bailing fatally; R2 readback fallbacks synthesize the resource + emit a warning rather than
      failing. Delegation between repositories forwards warnings via `runValueForwarding` /
      `runCollectForwarding` so warnings flow end-to-end through delegation chains. All three
      JSON:API servers serialize warnings into `meta.warnings` on collection, single-resource, void
      (delete), and per-op atomic results; JSON:API proxy backends read `meta.warnings` from
      upstream responses and re-emit them locally. The Decap CMS backend exposes an `onWarning` hook
      so host apps can route warnings into their own observability (Sentry, toasts, metrics) —
      defaults to a `console.warn` line so devtools show them.
- [x] Netlify git-gateway compatible HTTP handler (`@laikacms/git-gateway`) — lets Decap CMS
      configured with `backend: git-gateway` point at a Laika worker without changing client config
- [x] Hosted multi-tenant gateway app (`apps/laika-gateway`) — one GitHub App that anyone can
      install on their repo; tenants point Decap at the gateway URL
      (`/github/{owner}/{repo}/api/decap`) instead of standing up their own Worker. Namespaced URL
      scheme leaves room for `/gitlab/...` etc. later.
