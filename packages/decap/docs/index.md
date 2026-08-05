---
title: "@laikacms/decap"
order: 2
---

# `@laikacms/decap`

[Decap CMS](https://decapcms.org/) server-side integrations for `laikacms`: the OAuth2 server, the
Decap-compatible `decap-api` adapter, and the `createLaikaBackend()` Decap CMS backend.

```bash
pnpm add @laikacms/decap
```

> **Moved (July 2026, DCMS-492):** the client-side pieces that used to live here — icon widgets, the
> AI chat widget, the embedded-entry editor, config type utilities, and the Dutch locale — now ship
> with the `@laikacms/decap-cms` fork. `@laikacms/decap-ai` is discontinued.

See [Usage](./usage) for the `decap-api` options and a wiring example.

## Exports

| Export                                    | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `@laikacms/decap/decap-api`               | Decap-compatible HTTP API on top of a Laika storage |
| `@laikacms/decap/decap-oauth2`            | OAuth2 server (GitHub-style) for Decap login        |
| `@laikacms/decap/decap-cms-backend-laika` | Decap CMS backend (`createLaikaBackend()`)          |

Companion package: [`laikacms`](/reference/packages/laikacms/) (the core storage/documents/assets
package this backend sits on top of).
