# `@laikacms/starter-fastify-backend`

A **Fastify 5** backend that hosts the LaikaCMS web-standard `fetch` handler. The shape mirrors
`starter-express-backend` — same adapter idea — but adapted to Fastify's request lifecycle.

## Stack

- Fastify 5
- `laikacms` — FileSystem storage + ContentBase document model
- `@laikacms/decap-integrations/embedded` — `createEmbeddedLaika` + `minimalBlogConfig`
- A tiny request/response ↔ Web Request/Response adapter (`src/lib/fastify-fetch-adapter.ts`)

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-fastify-backend dev
```

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## How the adapter differs from Express

Same underlying trick — `Readable.toWeb(req.raw)` to stream the request body into a Web `Request`.
The Fastify-specific piece is disabling the built-in body parser globally:

```ts
fastify.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined));
```

This tells Fastify "for any content type, don't parse the body — leave it as a stream". The adapter
then drains the raw stream itself.

If you need body parsers on other routes (e.g. a `/api/upload` JSON endpoint), use route-level
content type parsers (`fastify.register(...)` with `bodyLimit`) instead of the global hook.

## Layout

```
apps/starter-fastify-backend/
├── content/posts/hello-world.md
├── src/
│   ├── server.ts                       # Fastify app + routes
│   ├── lib/
│   │   ├── laika.ts                    # createEmbeddedLaika
│   │   └── fastify-fetch-adapter.ts    # req/reply ↔ Request/Response
│   └── admin/index.html                # Decap CMS shell
└── tsconfig.json
```

## Why a Fastify starter on top of Hono and Express?

The three backend starters together show that LaikaCMS's web-standard `fetch` handler plugs into
**any** Node.js web framework:

| Framework | How to plug it in                                                                       |
| --------- | --------------------------------------------------------------------------------------- |
| Hono      | `app.all('/api/decap/*', c => laika.fetch(c.req.raw))` — Hono is web-standard natively. |
| Express   | Use `mountWebFetchHandler(...)` from the Express adapter; don't add `express.json()`.   |
| Fastify   | Use `mountWebFetchHandler(...)` from the Fastify adapter; disable the body parser.      |

## Production hardening

Same checklist as the other starters: real auth, persistent storage, self-hosted Decap shell. See
[`docs/starters.md`](../../docs/starters.md).
