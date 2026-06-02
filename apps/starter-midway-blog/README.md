# starter-midway-blog

A minimal blog using **Midway.js v4** (Koa adapter) + **LaikaCMS**.

Midway.js is Alibaba's TypeScript enterprise framework with an IoC container, decorator-based
controllers, and built-in Koa/Express adapters. Very popular in Chinese enterprise apps.

## Quick start

```bash
pnpm dev
```

Open <http://localhost:3000> for the blog and <http://localhost:3000/admin> for the CMS.

## Key patterns

### Body-parser bypass via Koa middleware

Do **not** import `@midwayjs/bodyparser`. Instead, register `DecapMiddleware` (which reads the raw
stream) before Midway can install any body parser. The `useMiddleware` call in `onReady()` runs
before any component-level middleware.

### Singleton LaikaCMS service

`@Provide() @Singleton()` on `LaikaService` ensures `createEmbeddedLaika` is called once at startup
and the same instance is injected into every controller and middleware request.

### Standalone bootstrap without CLI

Without the Midway CLI, create a `MidwayContainer` and pass it to `new Framework(container)`:

```ts
import { MidwayContainer } from '@midwayjs/core';
import { Framework } from '@midwayjs/koa';

const container = new MidwayContainer();
const framework = new Framework(container);
await framework.initialize({
  appDir: resolve(__dirname, '..'), // project root
  globalConfig: { koa: { port: 3000 } },
});
await framework.run();
```

`appDir` should be the **project root** (parent of `src/`). Midway.js scans `src/` for decorated
classes automatically.

## Structure

```
src/
  bootstrap.ts            standalone entry point
  configuration.ts        @Configuration — imports koa, registers middleware
  controller/
    blog.controller.ts    @Controller('/')  blog routes
  service/
    laika.service.ts      @Provide @Singleton  LaikaCMS instance
  middleware/
    decap.middleware.ts   @Middleware  raw-stream proxy for /api/decap/*
content/
  posts/                  markdown files managed by Decap
```

## Doc gaps surfaced

- Midway.js standalone bootstrap: `MidwayContainer` + `new Framework(container)`
- `appDir` is project root, not `src/` — Midway scans `<appDir>/src/` automatically
- Skip `@midwayjs/bodyparser` entirely; raw stream reading in `DecapMiddleware` is sufficient
- `@Singleton()` prevents `createEmbeddedLaika` being called on every request
