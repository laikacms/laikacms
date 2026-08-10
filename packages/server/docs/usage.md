---
title: Usage
order: 1
---

# Usage

Back to [`@laikacms/server` overview](./index.md).

## `api` options

Key options accepted by `laikaApi(options)`:

| Option                    | Type                                                     | Required | Description                                                                             |
| ------------------------- | -------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------- |
| `documents`               | `DocumentsRepository`                                    | yes      | Document storage backend                                                                |
| `storage`                 | `StorageRepository`                                      | yes      | Raw file storage backend                                                                |
| `assets`                  | `AssetsRepository`                                       | no       | Binary asset storage; enables the `/assets` endpoint when provided                      |
| `basePath`                | `string`                                                 | no       | URL prefix for all endpoints (e.g. `'/api/decap'`)                                      |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                       | yes      | Validates a Bearer access token and returns the principal's **identity**                |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                         | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access     |
| `authorize`               | `(ctx: AuthorizeContext) => boolean \| Promise<boolean>` | yes      | The authorization gate; return `false` to reject with `403`. Fails closed if it throws. |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>`        | no       | Receives structured diagnostic output                                                   |
| `cors`                    | `CorsOptions`                                            | no       | Required when the admin UI is served from a different origin than the API               |

## `authorize` — the authorization gate

Authentication answers _who_ the principal is; `authorize(ctx)` answers _what they may do_. There is
no implicit default — you must state the policy.

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only:
authorize: ctx => ctx.operation === 'read',

// Role-based:
authorize: ctx =>
  ctx.operation === 'read' ? true : ctx.user.roles.includes('editor'),
```

## Decap CMS backend options

`createLaikaBackend()` and `resolveLaikaBackend()` moved to the fork. See
`src/backends/laika/README.md` in `@laikacms/decap-cms` for their options.
