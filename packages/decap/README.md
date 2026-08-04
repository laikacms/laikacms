# @laikacms/decap

[Decap CMS](https://decapcms.org/) server-side integrations for
[Laika CMS](https://www.npmjs.com/package/laikacms): the OAuth2 server, the Decap-compatible
`decap-api` adapter, and the `createLaikaBackend()` Decap CMS backend
(`@laikacms/decap/decap-cms-backend-laika`).

> **Moved (July 2026, DCMS-492):** the client-side pieces that used to live here now ship with the
> `@laikacms/decap-cms` fork: icon widgets (`@laikacms/decap-cms/widgets/lucide-icon`,
> `…/widgets/radix-icon`), the AI chat widget (`…/widgets/aichat`) and server adapter (`…/ai`), the
> embedded-entry editor component (`…/editor-component-embedded-entry`), config type utilities
> (`…/config-types`), and the Dutch locale (`…/locales/nl`, bundled with all other locales). The
> `@laikacms/decap-ai` package is discontinued.

```bash
pnpm add @laikacms/decap
```

## Exports

### Backend & API

| Export                                    | Purpose                                             |
| ----------------------------------------- | --------------------------------------------------- |
| `@laikacms/decap/decap-api`               | Decap-compatible HTTP API on top of a Laika storage |
| `@laikacms/decap/decap-oauth2`            | OAuth2 server (GitHub-style) for Decap login        |
| `@laikacms/decap/decap-cms-backend-laika` | Decap CMS backend (`createLaikaBackend()`)          |

#### `decap-api` options

Key options accepted by `decapApi(options)`:

| Option                    | Type                                              | Required | Description                                                                                                                                                            |
| ------------------------- | ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`               | `DocumentsRepository`                             | yes      | Document storage backend                                                                                                                                               |
| `storage`                 | `StorageRepository`                               | yes      | Raw file storage backend                                                                                                                                               |
| `assets`                  | `AssetsRepository`                                | no       | Binary asset storage; enables the `/assets` endpoint when provided                                                                                                     |
| `basePath`                | `string`                                          | no       | URL prefix for all endpoints (e.g. `'/api/decap'`)                                                                                                                     |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                | yes      | Validates a Bearer access token and returns the user                                                                                                                   |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                  | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access                                                                                    |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>` | no       | Receives structured diagnostic output; forwarded to storage, documents, and assets API sub-handlers                                                                    |
| `cors`                    | `CorsOptions`                                     | no       | CORS configuration; required when the admin UI is served from a different origin than the API. Set `origins: '*'` for local dev, explicit origins list for production. |

#### `User` type

Both `authenticateAccessToken` and `authenticateApiToken` must return a `User` object. The built-in
fields are:

| Field          | Type                | Required | Description                                                                     |
| -------------- | ------------------- | -------- | ------------------------------------------------------------------------------- |
| `id`           | `string`            | yes      | Unique identifier for the principal                                             |
| `email`        | `string`            | yes      | Email address                                                                   |
| `name`         | `string`            | no       | Display name                                                                    |
| `passwordHash` | `string`            | no       | Stored by `decap-oauth2`; stripped before the user object is sent to the client |
| `scope`        | `'read' \| 'write'` | no       | Access scope — see below. Defaults to full access when omitted or `'write'`.    |

**`scope` — read-only credentials**

Return `scope: 'read'` to restrict a principal to safe (GET / HEAD / OPTIONS) requests only. Any
mutating method (POST, PUT, PATCH, DELETE) is rejected with `403 Forbidden` at the API boundary
before it reaches the underlying repositories. This lets you wire a read-only API key without
needing repositories that enforce per-credential access control:

```ts
authenticateApiToken: async key => {
  const apiKey = await db.apiKeys.findByKey(key);
  if (!apiKey) throw new Error('Invalid API key');
  return {
    id: apiKey.userId,
    email: apiKey.email,
    scope: apiKey.readOnly ? 'read' : 'write', // ← restrict writes for read-only keys
  };
},
```

Omitting `scope` (or setting it to `'write'`) leaves the principal with full access — this is the
default, so existing callbacks need no changes.

You can extend the `User` interface with custom fields by augmenting the module:

```ts
declare module '@laikacms/decap/decap-api' {
  interface User {
    role: 'admin' | 'editor';
    organizationId: string;
  }
}
```

#### `decap-api` return value

`decapApi(options)` returns a `DecapApi` object:

| Method                                                             | Description                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `fetch(request: Request): Promise<Response>`                       | Main catch-all handler — route all Decap API traffic here                                                                                                                                                                      |
| `authenticateRequest(request: Request): Promise<Response \| User>` | Validates the request's auth (Bearer or API key) and returns a `User` on success, or a `Response` (401/403) on failure. Use in SSR route handlers to protect pages or inject the current user without routing through the API. |

#### `decap-cms-backend-laika` options

`createLaikaBackend(options?)` accepts an optional options object:

| Option                   | Type                                                           | Default                                          | Description                                                                                                         |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `getDocumentsRepository` | `(opts: GetDocumentsRepositoryOptions) => DocumentsRepository` | `new DocumentsJsonApiProxyRepository(...)`       | Override the documents repository factory — use to add interceptors, logging, or custom routing                     |
| `getAssetsRepository`    | `(opts: GetAssetsRepositoryOptions) => AssetsRepository`       | `new AssetsJsonApiProxyRepository(...)`          | Override the assets repository factory                                                                              |
| `documentsApiBaseUrl`    | `string`                                                       | `Url.combine(base_url, api_root) + '/documents'` | Explicit documents API base URL; use when documents and assets APIs are served from different hosts or base paths   |
| `assetsApiBaseUrl`       | `string`                                                       | `Url.combine(base_url, api_root) + '/assets'`    | Explicit assets API base URL                                                                                        |
| `onWarning`              | `(error: LaikaError) => void`                                  | `console.warn(...)`                              | Hook called for every recoverable warning — use for structured logging, Sentry breadcrumbs, or observability toasts |

> **`opts.baseUrl` in custom factories** — both `GetDocumentsRepositoryOptions.baseUrl` and
> `GetAssetsRepositoryOptions.baseUrl` receive the _combined_ API URL
> (`Url.combine(base_url, api_root)` from the Decap backend config), not the raw `base_url`. With
> `base_url: 'https://api.example.com'` and `api_root: '/api'`, `opts.baseUrl` is
> `'https://api.example.com/api'`. The default factories append `/documents` and `/assets` to this
> value respectively, or use `documentsApiBaseUrl` / `assetsApiBaseUrl` when those are set.

The `backend:` block in your Decap config also accepts:

| Field         | Type       | Description                                                                                                    |
| ------------- | ---------- | -------------------------------------------------------------------------------------------------------------- |
| `acceptRoles` | `string[]` | Restrict access to users whose role matches one of the listed values (e.g. `acceptRoles: ['admin', 'editor']`) |

Example with split API hosts and observability:

```ts
import { createLaikaBackend } from '@laikacms/decap/decap-cms-backend-laika';
import * as Sentry from '@sentry/browser';

const LaikaBackend = createLaikaBackend({
  documentsApiBaseUrl: 'https://api.example.com/documents',
  assetsApiBaseUrl: 'https://cdn.example.com/assets',
  onWarning: err => {
    Sentry.addBreadcrumb({ category: 'laika', level: 'warning', message: err.message });
  },
});

export default LaikaBackend;
```

### i18n

i18n bundles are exposed per-module: `…/decap-oauth2/i18n`, `…/decap-oauth2/i18n/en`,
`…/decap-oauth2/i18n/nl`.

## Companion packages

- [`laikacms`](https://www.npmjs.com/package/laikacms) — core domain, APIs, serializers
- [`@laikacms/decap-cms`](https://www.npmjs.com/package/@laikacms/decap-cms) — the Decap CMS fork:
  app shell, widgets (incl. AI chat), laika backend, config types
- [`@laikacms/github`](https://www.npmjs.com/package/@laikacms/github) — GitHub storage
- [`@laikacms/aws`](https://www.npmjs.com/package/@laikacms/aws) — AWS implementations

## Documentation

See the [laikacms repository](https://github.com/laikacms/laikacms) for setup and integration
guides.

## License

MIT
