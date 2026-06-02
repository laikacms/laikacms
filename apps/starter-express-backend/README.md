# `@laikacms/starter-express-backend`

A **classic Express** backend that hosts the LaikaCMS web-standard `fetch` handler via a small,
dependency-free adapter. Use this starter when you already have an Express app and want to drop in
LaikaCMS without rewriting your server.

## Stack

- Express 4
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- A tiny `req`/`res` ↔ `Request`/`Response` adapter (`src/lib/express-fetch-adapter.ts`)

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-express-backend dev
```

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## The adapter

Express handlers get Node's `IncomingMessage` + `ServerResponse`. LaikaCMS speaks the web standard.
`src/lib/express-fetch-adapter.ts` provides three pieces:

```ts
toWebRequest(req); // ExpressRequest  -> Request
sendWebResponse(res, r); // pipe Response.body to ExpressResponse
mountWebFetchHandler(h); // wraps a (Request)=>Promise<Response> as Express middleware
```

Usage:

```ts
import { mountWebFetchHandler } from './lib/express-fetch-adapter';
app.all('/api/decap/*', mountWebFetchHandler(req => laika.fetch(req)));
```

⚠️ **Do not mount `express.json()` in front of the adapter** — the body parser would drain the
request stream before the adapter forwards it. The adapter relies on `Readable.toWeb(req)` to stream
the raw body to laika.

## Layout

```
apps/starter-express-backend/
├── content/
│   └── posts/
│       └── hello-world.md
├── src/
│   ├── server.ts                       # Express app + routes
│   ├── lib/
│   │   ├── laika.ts                    # createEmbeddedLaika
│   │   └── express-fetch-adapter.ts    # the bridge
│   └── admin/
│       └── index.html                  # Decap CMS shell
└── tsconfig.json
```

## Production hardening

Same as the other starters: real auth, persistent storage, self-hosted Decap shell. See
[`docs/starters.md`](../../docs/starters.md).
