---
title: Usage
order: 1
---

# Usage

Back to [`@laikacms/decap` overview](./index.md).

## `decap-api` options

Key options accepted by `decapApi(options)`:

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

## `decap-cms-backend-laika` options

`createLaikaBackend(options?)` accepts an optional options object:

| Option                   | Default                                          | Description                                                                                                         |
| ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `getDocumentsRepository` | `new DocumentsJsonApiProxyRepository(...)`       | Override the documents repository factory                                                                           |
| `getAssetsRepository`    | `new AssetsJsonApiProxyRepository(...)`          | Override the assets repository factory                                                                              |
| `documentsApiBaseUrl`    | `Url.combine(base_url, api_root) + '/documents'` | Explicit documents API base URL                                                                                     |
| `assetsApiBaseUrl`       | `Url.combine(base_url, api_root) + '/assets'`    | Explicit assets API base URL                                                                                        |
| `onWarning`              | `console.warn(...)`                              | Hook called for every recoverable warning — use for structured logging, Sentry breadcrumbs, or observability toasts |
