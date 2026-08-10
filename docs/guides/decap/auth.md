# Authentication

How callers prove who they are to `laikaApi(...)`: browser sessions, machine-to-machine API keys,
SSR guards, structured logging, the bundled OAuth2 server, and the multi-tenant hosted gateway.

## Machine-to-machine auth with `authenticateApiToken`

For server-to-server or CI/CD integrations that cannot perform an OAuth2 browser flow, you can
enable API key authentication by passing the optional `authenticateApiToken` option. When present,
any request that supplies a key via **either** of the two accepted header formats is routed through
this callback instead of `authenticateAccessToken`:

| Header format                 | Example                                |
| ----------------------------- | -------------------------------------- |
| `X-API-Key: <key>`            | `X-API-Key: sk-live-abc123`            |
| `Authorization: ApiKey <key>` | `Authorization: ApiKey sk-live-abc123` |

> Note: supplying `api_key` as a URL query-string parameter is explicitly rejected — keys in URLs
> leak through server logs, CDN logs, and browser history.

```ts
import { laikaApi } from '@laikacms/server/api';

const api = laikaApi({
  documents,
  storage,
  authenticateAccessToken: async token => {
    // validate OAuth2 / JWT bearer token, return the principal's identity
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    return db.users.findById(session.userId);
  },
  // Optional: enable API key auth for machine-to-machine access
  authenticateApiToken: async key => {
    const apiKey = await db.apiKeys.findByKey(key);
    if (!apiKey) throw new Error('Invalid API key');
    return db.users.findById(apiKey.userId);
  },
  // Required: decide what the authenticated principal may do (see below).
  authorize: () => true,
});
```

If `authenticateApiToken` is not configured and a request arrives with `X-API-Key` or
`Authorization: ApiKey`, the server returns `401`.

## Authorization with `authorize`

Authentication and authorization are cleanly separated: the `authenticate*` callbacks establish
**who** the principal is (their identity), and the **required** `authorize(ctx)` callback decides
**what they may do**. Return `true` to allow the request, `false` to reject it with `403 Forbidden`
before it reaches any repository. A thrown callback fails closed (treated as a denial). There is no
implicit default — you must state the policy.

`ctx` carries the principal plus the request pre-parsed so a policy can decide without re-parsing
the URL:

```ts
interface AuthorizeContext {
  user: User; // the identity from your authenticate* callback
  request: Request; // the raw request, for anything the fields below don't cover
  method: string; // upper-cased HTTP method
  domain: 'documents' | 'storage' | 'assets' | 'session';
  operation: 'read' | 'create' | 'update' | 'delete' | 'publish' | 'unpublish';
  collection?: string; // first path segment after the domain (the API resource)
  itemId?: string; // the item key/slug (URL-decoded), when present
}
```

```ts
// Allow everything authenticated:
authorize: () => true,

// Read-only principal — allow reads, reject anything that mutates:
authorize: ctx => ctx.operation === 'read',
```

### Role-based authorization

Because authorization is entirely in your hands, "scopes" and "roles" are just identity fields you
attach to the `User` and check in `authorize`. Augment the `User` interface with whatever your
policy needs:

```ts
declare module '@laikacms/server/api' {
  interface User {
    roles: string[];
  }
}

const api = laikaApi({
  documents,
  storage,
  authenticateAccessToken: yourValidator, // returns { id, email, roles, … }
  authorize: ctx => {
    if (ctx.operation === 'read') return true; // anyone authenticated may read
    if (ctx.operation === 'delete') return ctx.user.roles.includes('admin'); // only admins delete
    return ctx.user.roles.includes('editor'); // editors may create/update/publish
  },
});
```

Map `ctx.domain` + `ctx.collection` + `ctx.operation` to whatever permission vocabulary you like —
the API imposes none. Reach for `ctx.request` only for checks the parsed fields don't cover.

Read-only API keys are the same idea — return the relevant identity from `authenticateApiToken` and
branch on it in `authorize`:

```ts
authenticateApiToken: async key => {
  const apiKey = await db.apiKeys.findByKey(key);
  if (!apiKey) throw new Error('Invalid API key');
  return { id: apiKey.userId, email: apiKey.email, roles: apiKey.readOnly ? [] : ['editor'] };
},
```

### Scope-based authorization with `createScopePolicy`

For the common pattern of granting access based on fine-grained scopes (rather than flat roles),
`@laikacms/server/api` ships `createScopePolicy()` — a drop-in `authorize` factory that maps
every CMS request to a required scope and checks the principal's granted scopes. The scope
vocabulary lives in `laikacms/auth`:

| Scope           | Grants                                                              |
| --------------- | ------------------------------------------------------------------- |
| `content:read`  | GET requests to `/storage`, `/documents`                            |
| `content:write` | Mutating requests to `/storage`, `/documents`                       |
| `media:read`    | GET requests to `/assets`                                           |
| `media:write`   | Mutating requests to `/assets`                                      |
| `config:read`   | Read access to config atoms (checked at scope level, not API level) |
| `admin` / `*`   | Implies every scope                                                 |
| `resource:*`    | Implies every action on that resource (e.g. `content:*`)            |

```ts
import { createScopePolicy, laikaApi } from '@laikacms/server/api';

const api = laikaApi({
  documents,
  storage,
  authenticateAccessToken: async token => {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    // Return a User with scopes populated from the session record.
    return { id: session.userId, email: session.email, scopes: session.scopes };
  },
  // Grant access when the principal's scopes satisfy the required scope for
  // each domain + operation. Fails closed: no scopes → denied (except /session).
  authorize: createScopePolicy(),
});
```

`createScopePolicy` accepts an optional `options` object:

| Option             | Type                                          | Description                                                                            |
| ------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------- |
| `requiredScopeFor` | `(ctx: AuthorizeContext) => Scope \| null`    | Override the request → required-scope mapping. Return `null` to allow unconditionally. |
| `scopesOf`         | `(ctx: AuthorizeContext) => readonly Scope[]` | How to read the principal's granted scopes. Defaults to `ctx.user.scopes ?? []`.       |

`hasScope(granted, required)` from `laikacms/auth` resolves wildcards: `admin`/`*` satisfies
anything, and `resource:*` satisfies any `resource:action` on that resource. Use it directly if you
need a custom policy that still honours the wildcard semantics:

```ts
import { hasScope } from 'laikacms/auth';

authorize: ctx => {
  if (ctx.operation === 'read') return true;
  return hasScope(ctx.user.scopes ?? [], 'content:write');
},
```

### PAT bearer verification with `resolveBearer`

When you issue Personal Access Tokens (PATs) as well as session tokens, use `resolveBearer` from
`laikacms/auth` as the single seam in `authenticateAccessToken`. It detects a `lk_pat_…` prefix,
looks up the PAT record by hash, checks revocation/expiry, and falls back to your session verifier
for all other bearers — returning a unified `AuthContext` with the principal and their granted
scopes:

```ts
import { resolveBearer } from 'laikacms/auth';

authenticateAccessToken: async token => {
  const ctx = await resolveBearer(token, {
    verifySessionToken: async bearer => {
      const session = await db.sessions.findByAccessToken(bearer);
      if (!session) return null;
      return { user: { id: session.userId, email: session.email }, scopes: session.scopes };
    },
    lookupPatByHash: hash => db.pats.findByHash(hash),
    onPatUsed: record => db.pats.bumpLastUsedAt(record.id), // optional
  });
  if (!ctx) throw new Error('Invalid or expired token');
  // Attach the resolved scopes so createScopePolicy() (or your own authorize) can read them.
  return { id: ctx.user.id, scopes: ctx.scopes };
},
```

`resolveBearer` returns `null` for any invalid, revoked, or expired credential and never throws on
bad input — throw or return the error from `authenticateAccessToken` yourself.

## SSR auth guard with `authenticateRequest`

`laikaApi(...)` returns a `LaikaApi` object with two methods:

```ts
interface LaikaApi {
  fetch(request: Request): Promise<Response>;
  authenticateRequest(request: Request): Promise<Response | User>;
}
```

`authenticateRequest` runs the same Bearer/API-key validation as `fetch`, but returns the
authenticated `User` directly instead of routing the request to an API endpoint. Use it in SSR
frameworks to protect a page route or inject the current user into the render context without
duplicating auth logic:

```ts
// SvelteKit — src/routes/admin/+page.server.ts
import { api } from '$lib/decap'; // your laikaApi(...) instance
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ request }) => {
  const result = await api.authenticateRequest(request);
  if (result instanceof Response) throw redirect(302, '/login'); // 401 / 403
  return { user: result }; // result is User
};
```

The same pattern works in any framework that exposes a Web API `Request` at the route-handler
boundary (Next.js App Router, TanStack Start, Hono middleware, etc.).

## Logging with `logger`

Pass any `logger` compatible with the `Console` interface (`error`, `warn`, `info`, `debug`) to
receive structured diagnostic output from `laikaApi`. The option is optional — if omitted, no output
is produced.

```ts
const api = laikaApi({
  documents,
  storage,
  authenticateAccessToken: yourValidator,
  logger: console, // or a structured logger such as pino / winston
});
```

The logger is forwarded to the underlying `storage-api` and `documents-api` handlers so you get a
unified log stream from a single option.

## Production auth with `decap-oauth2`

Rather than building an OAuth2 server from scratch, use the bundled `laikaOauth2` helper. It is a
self-contained PKCE authorization server with email/password login, optional passkey (WebAuthn), and
optional TOTP 2FA. You wire it alongside the `laikaApi(...)` handler in the same Express or Hono
app.

```bash
pnpm add @laikacms/server
```

**Hono example**

```ts
import { laikaApi } from '@laikacms/server/api';
import { laikaOauth2 } from '@laikacms/server/oauth2';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { R2StorageRepository } from 'laikacms/storage-r2';

const CLIENT_ID = process.env.DECAP_CLIENT_ID!;
const OAUTH_BASE = '/oauth2';

const oauth2 = laikaOauth2({
  basePath: OAUTH_BASE,
  clientId: CLIENT_ID,
  callbacks: {
    // Return User | null — { id, email, passwordHash }
    getUserByEmail: async email => db.users.findByEmail(email),
    getUserById: async id => db.users.findById(id),

    // Authorization codes (one-time use, short-lived)
    storeAuthorizationCode: async code => db.authCodes.insert(code),
    getAuthorizationCode: async code => db.authCodes.findByCode(code),
    deleteAuthorizationCode: async code => db.authCodes.deleteByCode(code),

    // Sessions (hold both access + refresh tokens)
    createSession: async session => db.sessions.insert(session),
    getSessionByAccessToken: async token => db.sessions.findByAccessToken(token),
    getSessionByRefreshToken: async token => db.sessions.findByRefreshToken(token),
    logoutSession: async sessionId => db.sessions.deleteById(sessionId),
    logoutAll: async userId => db.sessions.deleteAllForUser(userId),
  },
});

// Build the Decap API handler — its validator checks the OAuth2 session token.
const storage = new R2StorageRepository(/* … */);
const settings = new DecapContentBaseSettingsProvider({ storage, configKey: 'config' });
const laika = laikaApi({
  documents: new ContentBaseDocumentsRepository(storage, settings),
  storage,
  assets: new ContentBaseAssetsRepository(storage, settings),
  basePath: '/api/decap',
  // Reject by throwing — laikaApi turns thrown errors into a 401.
  async authenticateAccessToken(token) {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    const user = await db.users.findById(session.userId);
    if (!user) throw new Error('Unknown user');
    return { id: user.id, email: user.email, name: user.email };
  },
  // Every authenticated principal may read and write.
  authorize: () => true,
});

const app = new Hono();
app.all(`${OAUTH_BASE}/*`, c => oauth2.fetch(c.req.raw));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

export default app;
```

**Express example** (uses the [manual bridge](./frameworks#express--plain-httpserver--manual-bridge)
for `laika`):

```ts
import { laikaOauth2 } from '@laikacms/server/oauth2';
import express from 'express';

const oauth2 = laikaOauth2({ basePath: '/oauth2', clientId: CLIENT_ID, callbacks });

const app = express();
// oauth2 speaks Web API — it has its own body parsing, no express.json() needed here
app.all('/oauth2/*', async (req, res) => {
  const url = `${req.protocol}://${req.headers.host}${req.originalUrl}`;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = chunks.length ? Buffer.concat(chunks) : null;
  const webRequest = new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body
      ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer)
      : null,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);
  const webResponse = await oauth2.fetch(webRequest);
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await webResponse.arrayBuffer()));
});
// Mount laika with the same bridge (see Express bridge section)
app.all('/api/decap/*', (req, res) => bridgeToLaika(req, res, laika));
```

**Point Decap at the OAuth2 server**

In your Decap config, set `backend.base_url` to the origin where the OAuth2 server runs and
`backend.auth_endpoint` to the authorize path:

```ts
const decapConfig = {
  backend: {
    name: 'laika',
    api_root: '/api/decap',
    base_url: 'https://cms.example.com', // origin serving /oauth2/*
    auth_endpoint: '/oauth2/authorize',
  },
  // …collections…
};
```

Use this same `decapConfig` when building the admin shell (see
[Serving the Decap admin shell](./admin-shell) above) so the editor performs the PKCE login against
`/oauth2/authorize`.

**Optional extensions**

| Feature        | Option key in `laikaOauth2(…)`       | Notes                                            |
| -------------- | ------------------------------------ | ------------------------------------------------ |
| Passkey        | `passkey: { enabled: true, … }`      | WebAuthn registration + authentication flows     |
| TOTP 2FA       | `totp: { … }`                        | TOTP enrollment and per-login verification       |
| CAPTCHA        | `captcha: { enabled: true, … }`      | Any provider (reCAPTCHA, hCaptcha, Turnstile, …) |
| Password reset | `passwordReset: { … }`               | Email-based reset link flow                      |
| i18n           | `translations: nl` (or other locale) | Import from `@laikacms/server/oauth2/i18n`       |

See
[`packages/server/src/oauth2/README.md`](https://github.com/laikacms/laikacms/blob/develop/packages/server/src/oauth2/README.md)
for the full `OAuthConfig` option reference.

---

## Hosted gateway (multi-tenant)

If multiple sites share one editing experience, host a gateway Worker separately and point each
site's Decap admin at it. Auth is per-tenant via GitHub OAuth (or other). Storage is the tenant's
own GitHub repo. The `laika-gateway` app and the `@laikacms/git-gateway` package were moved out of
this monorepo in June 2026; they now live in their own repositories.
