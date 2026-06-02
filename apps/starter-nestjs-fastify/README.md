# starter-nestjs-fastify

Starter blog built with [NestJS](https://nestjs.com) + [Fastify](https://fastify.dev) adapter +
[LaikaCMS](https://laikacms.dev).

## What this demonstrates

- **NestJS + Fastify adapter** — swaps `@nestjs/platform-express` for `@nestjs/platform-fastify`.
  Same NestJS DI, modules, and decorators; Fastify handles the HTTP layer.
- **JSON re-serialization bridge** — Fastify pre-parses JSON bodies before route handlers run.
  `laika-request.util.ts` re-serializes `req.body` with `JSON.stringify()` to reconstruct the WHATWG
  `Request` for `laika.fetch`. Compare with `starter-nestjs-blog` (Express) where the raw byte
  stream is available from `IncomingMessage`.
- **`decapAdminHtml()` + `minimalBlogConfig()`** — admin shell generated server-side; no
  `admin-client.ts` bundle or esbuild step.
- **`laika.documents.*` via `laikacms/compat`** — `collectStream` and `runTask` bypass HTTP auth for
  server-side reads.

## Getting started

```bash
cd apps/starter-nestjs-fastify
pnpm install
pnpm build && pnpm start   # production
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS.

## Key integration notes

**Fastify body pre-parsing vs. raw streaming:**

| Adapter                                | Body access in handler       | Laika bridge               |
| -------------------------------------- | ---------------------------- | -------------------------- |
| Express (`starter-nestjs-blog`)        | Raw `IncomingMessage` stream | Stream bytes directly      |
| **Fastify** (`starter-nestjs-fastify`) | `req.body` as JS object      | `JSON.stringify(req.body)` |

This works for Decap because all Decap API payloads are JSON. If Decap ever sends non-JSON binary
payloads, the Fastify starter would need a `rawBody` Fastify plugin or a custom content-type parser.
The Gatsby starter has the same constraint.

**`@Res()` passthrough in NestJS/Fastify:** When using `@Res()` (without `passthrough: true`),
NestJS hands reply control to the handler. Calling `reply.send()` is required. With
`passthrough: true` you can return a value from the handler instead — but full control is needed for
the decap proxy to set status and headers.

## Project structure

```
apps/starter-nestjs-fastify/
├── content/
│   └── posts/          # Markdown posts managed by LaikaCMS
├── public/             # Media uploads (public/uploads/)
├── src/
│   ├── app.module.ts
│   ├── laika.service.ts         # createEmbeddedLaika + decapAdminHtml singleton
│   ├── laika-request.util.ts    # FastifyRequest → WHATWG Request bridge
│   ├── blog/
│   │   ├── blog.controller.ts   # GET / and /blog/:slug (uses FastifyReply)
│   │   └── blog.module.ts
│   └── decap/
│       ├── decap.controller.ts  # ALL /api/decap/* → laika.fetch
│       └── decap.module.ts
├── package.json
├── tsconfig.json
└── tsconfig.build.json
```
