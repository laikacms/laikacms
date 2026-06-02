# starter-platformatic-blog

Starter blog built with [Platformatic Service 2](https://platformatic.dev) +
[LaikaCMS](https://laikacms.dev).

## What this demonstrates

- **Fastify plugin for LaikaCMS** — `src/plugins/laika.ts` is a `fastify-plugin`-wrapped Fastify
  plugin. It registers the Decap proxy, admin shell, and blog routes. Because Platformatic Service
  is a thin config wrapper around Fastify, the same plugin file works with _both_ the direct tsx dev
  server (`pnpm dev`) and the Platformatic CLI (`pnpm plt:start`).
- **Raw-stream bridge** — Platformatic wraps Node's `IncomingMessage`. We read the raw body from
  `req.raw` via `Readable.toWeb(req.raw)` — no JSON re-serialization, no body-parser bypass tricks.
  The wildcard `addContentTypeParser('*', ...)` disables Fastify's body parser for every route so
  the stream is still available when the Decap proxy runs.
- **Dual run modes**:
  - `pnpm dev` — tsx watch mode (no build step, fast iteration)
  - `pnpm plt:start` — Platformatic CLI reads `platformatic.service.json`, compiles TypeScript via
    `pnpm build`, and starts the server with built-in health checks and metrics support.

## Getting started

```bash
cd apps/starter-platformatic-blog
pnpm install
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS.

### Platformatic CLI mode

```bash
pnpm build          # compile TypeScript to dist/
pnpm plt:start      # npx platformatic service start (reads platformatic.service.json)
```

This starts the server using Platformatic's own runtime, which adds health checks at `/health` and
optionally Prometheus metrics — see `platformatic.service.json`.

## Key integration notes

**Plugin file as the single source of truth:**

```ts
// src/plugins/laika.ts
import fp from 'fastify-plugin';

export default fp(async app => {
  // wildcard body parser — disables Fastify's default parser for all routes
  app.addContentTypeParser('*', (_req, _payload, done) => done(null, undefined));

  // Decap proxy: raw IncomingMessage → Web API Request → laika.fetch
  app.all('/api/decap/*', async (req, reply) => {
    await sendWebResponse(reply, await laika.fetch(toWebRequest(req)));
  });
  // ...admin, blog index, blog post
});
```

**Registered in `platformatic.service.json`:**

```json
{
  "plugins": {
    "paths": [{ "path": "dist/plugins/laika.js", "encapsulate": false }]
  }
}
```

**Or registered directly in `src/server.ts` (tsx path):**

```ts
const app = Fastify({ logger: true });
await app.register(laikaPlugin);
await app.listen({ port: 3000, host: '0.0.0.0' });
```

**Why `encapsulate: false`?**

Platformatic sets `encapsulate: true` by default so plugins can't pollute the root scope. Setting it
to `false` makes this plugin behave like a root-level Fastify plugin — needed so the wildcard
content-type parser applies to all routes, not just those declared inside the plugin scope.

## Project structure

```
apps/starter-platformatic-blog/
├── src/
│   ├── plugins/
│   │   └── laika.ts            # LaikaCMS Fastify plugin (proxy + admin + blog)
│   └── server.ts               # Dev entry point (tsx, no build step)
├── content/
│   └── posts/                  # Markdown posts managed by LaikaCMS
├── dist/                       # Compiled output (tsc, for platformatic CLI)
├── platformatic.service.json   # Platformatic Service config
├── tsconfig.json
└── package.json
```

## Production hardening

- Replace `auth: { mode: 'dev' }` with real JWT or OAuth auth.
- Replace FileSystem storage with S3 or another persistent store.
- Self-host the Decap CMS bundle: override `decapBundleUrl` in `decapAdminHtml()`.
- Use Platformatic's `metrics` config to expose Prometheus metrics.
- Deploy with `pnpm build && pnpm plt:start` (or wrap in a Docker container).
