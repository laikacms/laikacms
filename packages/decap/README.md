# @laikacms/decap

[Decap CMS](https://decapcms.org/) server-side integrations for
[Laika CMS](https://www.npmjs.com/package/laikacms): the OAuth2 server and the Decap-compatible
`decap-api` adapter. The `laika` Decap backend itself lives in the `@laikacms/decap-cms` fork at
`@laikacms/decap-cms/backends/laika`.

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

| Export                         | Purpose                                             |
| ------------------------------ | --------------------------------------------------- |
| `@laikacms/decap/decap-api`    | Decap-compatible HTTP API on top of a Laika storage |
| `@laikacms/decap/decap-oauth2` | OAuth2 server (GitHub-style) for Decap login        |

The Decap CMS backend that talks to `decap-api` lives in the fork:
`@laikacms/decap-cms/backends/laika`.

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
