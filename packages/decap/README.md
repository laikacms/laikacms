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

| Option                    | Type                                                     | Required | Description                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `documents`               | `DocumentsRepository`                                    | yes      | Document storage backend                                                                                                                                                         |
| `storage`                 | `StorageRepository`                                      | yes      | Raw file storage backend                                                                                                                                                         |
| `assets`                  | `AssetsRepository`                                       | no       | Binary asset storage; enables the `/assets` endpoint when provided                                                                                                               |
| `basePath`                | `string`                                                 | no       | URL prefix for all endpoints (e.g. `'/api/decap'`)                                                                                                                               |
| `authenticateAccessToken` | `(token: string) => Promise<User>`                       | yes      | Validates a Bearer access token and returns the principal's **identity**                                                                                                         |
| `authenticateApiToken`    | `(key: string) => Promise<User>`                         | no       | Validates an API key sent via `X-API-Key` or `Authorization: ApiKey` for M2M access                                                                                              |
| `authorize`               | `(ctx: AuthorizeContext) => boolean \| Promise<boolean>` | yes      | The authorization gate — decides what the authenticated principal may do. Receives the pre-parsed `ctx` (below). Return `false` to reject with `403`. Fails closed if it throws. |
| `logger`                  | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>`        | no       | Receives structured diagnostic output; forwarded to storage, documents, and assets API sub-handlers                                                                              |
| `cors`                    | `CorsOptions`                                            | no       | CORS configuration; required when the admin UI is served from a different origin than the API. Set `origins: '*'` for local dev, explicit origins list for production.           |

#### `User` type

The `authenticate*` callbacks return a `User` — the principal's **identity**, nothing more.
Authorization is a separate concern handled by `authorize` (see below), so `User` carries no
access/permission fields. The built-in identity fields are:

| Field          | Type     | Required | Description                                                                     |
| -------------- | -------- | -------- | ------------------------------------------------------------------------------- |
| `id`           | `string` | yes      | Unique identifier for the principal                                             |
| `email`        | `string` | yes      | Email address                                                                   |
| `name`         | `string` | no       | Display name                                                                    |
| `passwordHash` | `string` | no       | Stored by `decap-oauth2`; stripped before the user object is sent to the client |

Extend `User` with whatever identity/claim fields your `authorize` policy needs by augmenting the
module:

```ts
declare module '@laikacms/decap/decap-api' {
  interface User {
    roles: string[];
    organizationId: string;
  }
}
```

#### `authorize` — the authorization gate (required)

Authentication answers _who_ the principal is; `authorize(ctx)` answers _what they may do_. Return
`true` to allow, `false` to reject with `403 Forbidden` before the request reaches any repository. A
thrown callback fails closed. There is no implicit default — you must state the policy.

`ctx` is an `AuthorizeContext` — the principal plus the request pre-parsed so a policy needn't
re-parse the URL:

```ts
interface AuthorizeContext {
  user: User; // identity from your authenticate* callback
  request: Request; // raw request, for anything the parsed fields don't cover
  method: string; // upper-cased HTTP method
  domain: 'documents' | 'storage' | 'assets' | 'session';
  operation: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish';
  collection?: string; // first path segment after the domain (the API resource)
  itemId?: string; // item key/slug, URL-decoded, when present
}
```

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only — allow reads, reject anything that mutates:
authorize: ctx => ctx.operation === 'read',

// Role-based (with `interface User { roles: string[] }` augmented in):
authorize: ctx =>
  ctx.operation === 'read' ? true : ctx.user.roles.includes('editor'),
```

"Scopes" and "roles" are just identity fields you attach to the `User` and check here — the API
imposes no fixed permission vocabulary. Map `ctx.domain`/`ctx.collection`/`ctx.operation` to your
own permissions; reach for `ctx.request` only for what the parsed fields don't cover.

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

#### `resolveLaikaBackend` — dev/remote backend selector (LCMS-449)

`@laikacms/vite-plugin`'s `localApi` option (Slice 1) mounts LaikaCMS's own JSON:API on the Vite dev
server at `/__laika` by default, so Decap can read and write local content while you develop instead
of mutating a remote backend. `resolveLaikaBackend({ local, remote })` picks the Decap `backend:`
config to hand to `CMS.init` — the local one while `vite dev` is running, the remote OAuth one
everywhere else — so a single admin config needs no manual switching:

```ts
import { createLaikaBackend, resolveLaikaBackend } from '@laikacms/decap/decap-cms-backend-laika';
import CMS from 'decap-cms-app';

CMS.registerBackend('laika', createLaikaBackend());

CMS.init({
  config: {
    backend: resolveLaikaBackend({
      remote: { name: 'laika', base_url: 'https://api.example.com', app_id: 'your-app-id' },
    }),
    collections: [
      /* ... */
    ],
  },
});
```

The selector reads `import.meta.env.DEV` — **this requires the admin config to be bundled by Vite**;
a standalone/non-Vite admin is treated as remote. It fails safe to `remote` whenever the dev flag
isn't truthy, so a production build (or any context where Vite hasn't substituted the flag) never
targets the local endpoint.

| Option   | Type                       | Required | Description                                                                                                                                                                  |
| -------- | -------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local`  | `LocalLaikaBackendOptions` | no       | `{ basePath?, devToken? }` — overrides for the local backend. `basePath` defaults to `/__laika` (must match `localApi.basePath`); `devToken` defaults to a fixed dummy value |
| `remote` | `LaikaBackendModuleConfig` | yes      | The remote OAuth `backend:` config, used as-is whenever the dev flag isn't truthy                                                                                            |
| `dev`    | `boolean`                  | no       | Overrides `import.meta.env.DEV`; only tests should pass this — real usage relies on the default so no wiring is needed                                                       |

The local backend uses `dev_token` under the hood — the same mechanism `DevAuthenticationPage`
already renders for whenever `config.backend.dev_token` is set (see
`decap-cms-backend-laika/laika-backend.ts`) — so no interactive login happens locally. Both
`createLaikaBackend` and `DevAuthenticationPage` stay exported for hand-wiring a custom local/remote
arrangement instead of using `resolveLaikaBackend`.

> **The local API's `/session` endpoint is a trivial stub.** `LaikaBackend.authenticate()` always
> pings `${apiUrl}/session` to resolve a display identity, even for the dummy-token local path.
> `@laikacms/vite-plugin`'s `localApi` therefore also mounts `${basePath}/session`, returning a
> fixed unauthenticated stub identity — not a fourth repository-backed sub-API.

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
