# starter-custom-auth

Starter blog showing **production-ready authentication** with [LaikaCMS](https://laikacms.dev) using
`createEmbeddedLaika({ auth: { mode: 'custom' } })`.

## What this demonstrates

- **`mode: 'custom'` auth** — instead of `mode: 'dev'` (which accepts any bearer token and returns a
  hardcoded editor), `mode: 'custom'` lets you validate every token against your own user store:
  JWT, database lookup, Auth0, Firebase, etc.
- **`decapAdminHtml({ devToken: apiKey })`** — the new `devToken` option on `decapAdminHtml()` lets
  you inject any string as the `backend.dev_token`. The Decap frontend sends it as
  `Authorization: Bearer <token>`, which your `authenticateAccessToken` callback receives and
  validates. No OAuth dance needed for single-organization / intranet setups.
- **`authenticateApiToken`** — optional second callback for `Authorization: ApiKey <key>` or
  `X-API-Key` header. Useful for CI scripts that manage content programmatically.
- **Hono + WHATWG-native bridge** — `laika.fetch(c.req.raw)` — zero conversion overhead.

## Getting started

```bash
cd apps/starter-custom-auth
pnpm install

# Optional: set a real API key (defaults to 'change-me-in-production')
export EDITOR_API_KEY=your-secret-key-here

pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS.

## The auth API

```ts
import { AuthenticationError, createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

const laika = createEmbeddedLaika({
  contentDir,
  decapConfig,
  basePath: '/api/decap',
  auth: {
    mode: 'custom',

    // Called for every `Authorization: Bearer <token>` request.
    // Throw or reject to deny. Return a User to allow.
    authenticateAccessToken: async token => {
      const user = await db.users.findByApiKey(token);
      if (!user) throw new AuthenticationError('Invalid token');
      return { id: user.id, email: user.email, name: user.name };
    },

    // Optional: called for `Authorization: ApiKey <key>` or `X-API-Key` header.
    authenticateApiToken: async key => {
      const user = await db.users.findByApiKey(key);
      if (!user) throw new AuthenticationError('Invalid key');
      return { id: user.id, email: user.email };
    },
  },
});
```

Replace the body with any auth provider:

| Provider    | Swap in                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| JWT (HS256) | `const { payload } = await jose.jwtVerify(token, secret); return payload` |
| JWT (RS256) | `const { payload } = await jose.jwtVerify(token, JWKS); return payload`   |
| Firebase    | `const decoded = await admin.auth().verifyIdToken(token); return decoded` |
| Auth0       | `const user = await mgmt.getUser({ id: decoded.sub }); return user`       |
| Supabase    | `const { data: user } = await supabase.auth.getUser(token); return user`  |
| Clerk       | `const claims = await clerkClient.verifyToken(token); return claims`      |

## Admin HTML and the `devToken` option

```ts
// Pass the API key as devToken — Decap auto-logs in without an OAuth popup.
const adminHtml = decapAdminHtml({
  decapConfig,
  devToken: process.env.EDITOR_API_KEY,
});

// For a full OAuth/PKCE flow (no pre-shared token):
// const adminHtml = decapAdminHtml({ decapConfig, devToken: false });
// — then implement /auth/authorize and /auth/callback endpoints yourself.
```

## Production checklist

- [ ] Store API keys hashed (bcrypt/argon2), never in plaintext.
- [ ] Use JWTs with short expiry and a refresh-token flow instead of long-lived API keys.
- [ ] Set `EDITOR_API_KEY` (or JWT secret) via environment variable, not source code.
- [ ] Replace FileSystem storage with S3 or another persistent store.
- [ ] Self-host the Decap CMS bundle: override `decapBundleUrl` in `decapAdminHtml()`.
- [ ] Enable HTTPS; set `Secure` and `SameSite=Strict` on session cookies if you add them.

## Project structure

```
apps/starter-custom-auth/
├── src/
│   └── server.ts      # Hono server — custom auth, blog routes, admin HTML
├── content/
│   └── posts/         # Markdown posts managed by LaikaCMS
├── package.json
├── tsconfig.json
└── README.md
```
