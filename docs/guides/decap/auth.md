# Authentication

How callers prove who they are to `decapApi(...)`: browser sessions, machine-to-machine API keys,
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
import { decapApi } from '@laikacms/decap/decap-api';

const api = decapApi({
  documents,
  storage,
  authenticateAccessToken: async token => {
    // validate OAuth2 / JWT bearer token
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
});
```

If `authenticateApiToken` is not configured and a request arrives with `X-API-Key` or
`Authorization: ApiKey`, the server returns `401`.

## SSR auth guard with `authenticateRequest`

`decapApi(...)` returns a `DecapApi` object with two methods:

```ts
interface DecapApi {
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
import { api } from '$lib/decap'; // your decapApi(...) instance
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
receive structured diagnostic output from `decapApi`. The option is optional — if omitted, no output
is produced.

```ts
const api = decapApi({
  documents,
  storage,
  authenticateAccessToken: yourValidator,
  logger: console, // or a structured logger such as pino / winston
});
```

The logger is forwarded to the underlying `storage-api` and `documents-api` handlers so you get a
unified log stream from a single option.

## Production auth with `decap-oauth2`

Rather than building an OAuth2 server from scratch, use the bundled `decapOauth2` helper. It is a
self-contained PKCE authorization server with email/password login, optional passkey (WebAuthn), and
optional TOTP 2FA. You wire it alongside the `decapApi(...)` handler in the same Express or Hono
app.

```bash
pnpm add @laikacms/decap
```

**Hono example**

```ts
import { decapApi } from '@laikacms/decap/decap-api';
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';
import { Hono } from 'hono';
import { ContentBaseAssetsRepository } from 'laikacms/assets-contentbase';
import { DecapContentBaseSettingsProvider } from 'laikacms/contentbase-settings-decap';
import { ContentBaseDocumentsRepository } from 'laikacms/documents-contentbase';
import { R2StorageRepository } from 'laikacms/storage-r2';

const CLIENT_ID = process.env.DECAP_CLIENT_ID!;
const OAUTH_BASE = '/oauth2';

const oauth2 = decapOauth2({
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
const laika = decapApi({
  documents: new ContentBaseDocumentsRepository(storage, settings),
  storage,
  assets: new ContentBaseAssetsRepository(storage, settings),
  basePath: '/api/decap',
  // Reject by throwing — decapApi turns thrown errors into a 401.
  async authenticateAccessToken(token) {
    const session = await db.sessions.findByAccessToken(token);
    if (!session) throw new Error('Invalid session');
    const user = await db.users.findById(session.userId);
    if (!user) throw new Error('Unknown user');
    return { id: user.id, email: user.email, name: user.email };
  },
});

const app = new Hono();
app.all(`${OAUTH_BASE}/*`, c => oauth2.fetch(c.req.raw));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

export default app;
```

**Express example** (uses the [manual bridge](./frameworks#express--plain-httpserver--manual-bridge)
for `laika`):

```ts
import { decapOauth2 } from '@laikacms/decap/decap-oauth2';
import express from 'express';

const oauth2 = decapOauth2({ basePath: '/oauth2', clientId: CLIENT_ID, callbacks });

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

| Feature        | Option key in `decapOauth2(…)`       | Notes                                            |
| -------------- | ------------------------------------ | ------------------------------------------------ |
| Passkey        | `passkey: { enabled: true, … }`      | WebAuthn registration + authentication flows     |
| TOTP 2FA       | `totp: { … }`                        | TOTP enrollment and per-login verification       |
| CAPTCHA        | `captcha: { enabled: true, … }`      | Any provider (reCAPTCHA, hCaptcha, Turnstile, …) |
| Password reset | `passwordReset: { … }`               | Email-based reset link flow                      |
| i18n           | `translations: nl` (or other locale) | Import from `@laikacms/decap/decap-oauth2/i18n`  |

See
[`packages/decap/src/decap-oauth2/README.md`](https://github.com/laikacms/laikacms/blob/develop/packages/decap/src/decap-oauth2/README.md)
for the full `OAuthConfig` option reference.

---

## Hosted gateway (multi-tenant)

If multiple sites share one editing experience, host a gateway Worker separately and point each
site's Decap admin at it. Auth is per-tenant via GitHub OAuth (or other). Storage is the tenant's
own GitHub repo. The `laika-gateway` app and the `@laikacms/git-gateway` package were moved out of
this monorepo in June 2026 (see [restructure-2026-06.md](../../contributing/restructure-2026-06));
they now live in their own repositories.
