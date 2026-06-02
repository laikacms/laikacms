# starter-session-auth

Starter blog showing **session-based authentication** with [LaikaCMS](https://laikacms.dev): login
page → session cookie → per-request JWT injection into the Decap CMS admin.

## What this demonstrates

- **Login page** — a proper `/login` form before the CMS admin. The admin at `/admin` is behind
  middleware that redirects unauthenticated visitors to `/login`.
- **Session cookies** — `httpOnly`, `SameSite=Strict` cookie storing a short-lived JWT (1 h).
  Verified by middleware on each `/admin` request.
- **Per-request `decapAdminHtml()`** — unlike starters that call `decapAdminHtml()` once at startup,
  here we call it on every `GET /admin` to embed the current session's JWT as `devToken`. The
  function is pure string interpolation, so per-request use is fine and means every admin page load
  gets a fresh token.
- **`jose.jwtVerify` in `authenticateAccessToken`** — the Decap frontend sends
  `Authorization: Bearer <jwt>` on every CMS request; `authenticateAccessToken` verifies the
  signature and expiry via `jose.jwtVerify`.
- **`mode: 'custom'` auth** — full custom auth without any hardcoded dev tokens.

## Getting started

```bash
cd apps/starter-session-auth
pnpm install

# Optional: override defaults
export ADMIN_EMAIL=you@example.com
export ADMIN_PASSWORD=supersecret
export JWT_SECRET=at-least-32-random-bytes-here

pnpm dev
```

Open <http://localhost:3000/login>, sign in, and you'll be redirected to the CMS at
<http://localhost:3000/admin>.

## The auth flow

```
Browser                    Server                    LaikaCMS
  │                           │                          │
  ├─── GET /login ───────────►│                          │
  │◄── login form HTML ───────┤                          │
  │                           │                          │
  ├─── POST /login ──────────►│                          │
  │    { email, password }    │ verify credentials       │
  │                           │ sign JWT (1h, HS256)     │
  │◄── Set-Cookie: session=JWT┤                          │
  │◄── 302 /admin ────────────┤                          │
  │                           │                          │
  ├─── GET /admin ────────────►│                         │
  │    Cookie: session=JWT    │ jwtVerify(JWT)           │
  │                           │ decapAdminHtml({         │
  │                           │   devToken: JWT })       │
  │◄── admin HTML (JWT inside)┤                          │
  │                           │                          │
  ├─── Decap: GET /api/decap/*►│ Authorization: Bearer JWT
  │                           │──────────────────────────►│
  │                           │                          │ jwtVerify(JWT)
  │                           │◄─────────────────────────┤
  │◄── CMS content ───────────┤                          │
```

## JWT setup

```ts
import { jwtVerify, SignJWT } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

// Issue token on login
const token = await new SignJWT({ email, name })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(userId)
  .setExpirationTime('1h')
  .sign(JWT_SECRET);

// Verify in authenticateAccessToken
const { payload } = await jwtVerify(token, JWT_SECRET);
return { id: payload.sub!, email: payload.email as string };
```

### Switching to asymmetric keys (RS256)

Asymmetric keys let you issue tokens on one service and verify on another without sharing a secret:

```ts
import { generateKeyPair, importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';

// Generate once and store in env vars
const { privateKey, publicKey } = await generateKeyPair('RS256');

// Sign with private key
const token = await new SignJWT(claims)
  .setProtectedHeader({ alg: 'RS256' })
  .sign(privateKey);

// Verify with public key (safe to distribute)
const { payload } = await jwtVerify(token, publicKey);
```

## Project structure

```
apps/starter-session-auth/
├── src/
│   └── server.ts      # Hono server — session auth, login page, admin, blog
├── content/
│   └── posts/         # Markdown posts managed by LaikaCMS
├── package.json
├── tsconfig.json
└── README.md
```

## Production checklist

- [ ] Replace plaintext password comparison with `bcrypt`/`argon2id`.
- [ ] Store users in a database — never hard-code credentials.
- [ ] Use a long random `JWT_SECRET` (32+ bytes) from an environment variable.
- [ ] Switch to RS256 / ES256 asymmetric keys for multi-service setups.
- [ ] Add CSRF protection if you accept form POST from a browser.
- [ ] Set `secure: true` on the session cookie behind HTTPS.
- [ ] Replace FileSystem storage with S3 or another persistent store.
