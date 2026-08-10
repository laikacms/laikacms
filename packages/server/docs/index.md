---
title: "@laikacms/server"
order: 2
---

# `@laikacms/server`

The HTTP surface for `laikacms`: a single-endpoint JSON:API router over the `laikacms` repositories,
and a self-contained OAuth 2.0 authorization server. Both are CMS-agnostic, with no React or
admin-UI dependency.

```bash
pnpm add @laikacms/server
```

> **Renamed (August 2026):** this package was `@laikacms/decap`; `decap-api` and `decap-oauth2` are
> now `@laikacms/server/api` and `@laikacms/server/oauth2`, with `decapApi`/`decapOauth2` renamed to
> `laikaApi`/`laikaOauth2`. The Decap CMS backend moved to `@laikacms/decap-cms/backends/laika`.

> **Moved (July 2026, DCMS-492):** the client-side pieces that used to live here — icon widgets, the
> AI chat widget, the embedded-entry editor, config type utilities, and the Dutch locale — now ship
> with the `@laikacms/decap-cms` fork. `@laikacms/decap-ai` is discontinued.

See [Usage](./usage) for the `api` options and a wiring example.

## Exports

| Export                    | Purpose                                                          |
| ------------------------- | ---------------------------------------------------------------- |
| `@laikacms/server/api`    | Single-endpoint JSON:API router over the `laikacms` repositories |
| `@laikacms/server/oauth2` | OAuth 2.0 authorization server (PKCE, passkey, TOTP, email)      |

The admin-side counterpart, `createLaikaBackend()`, ships with the fork as
`@laikacms/decap-cms/backends/laika`.

Companion package: [`laikacms`](/reference/packages/laikacms/) (the core storage/documents/assets
package this backend sits on top of).
