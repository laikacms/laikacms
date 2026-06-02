# starter-angular-cli-blog

Starter blog built with [Angular 21 SSR](https://angular.dev/guide/ssr) (standard Angular CLI) +
[LaikaCMS](https://github.com/laikacms/laikacms).

> **Angular CLI vs Vite SSR**: This starter uses the standard Angular CLI workflow (`ng serve`,
> `ng build`, `angular.json`). For an Angular SSR approach without the Angular CLI (using
> `@analogjs/vite-plugin-angular` + Vite directly), see `starter-angular-ssr-blog`.

Demonstrates:

- `createEmbeddedLaika` + `@angular/ssr` — Angular's built-in SSR with Express
- `laika.documents.*` via `/api/posts` Express routes (same Express process)
- Decap CMS admin via `afterNextRender` (Angular's client-only side-effect hook)
- `AngularNodeAppEngine` + `createNodeRequestHandler` — Angular 18+ SSR adapter
- Express → Web API bridging pattern (`toLaikaRequest`) for `laika.fetch`

## Quick start

```bash
pnpm install
pnpm dev        # ng serve with live reload
```

## Production

```bash
pnpm build      # ng build — outputs to dist/starter-angular-ssr-blog/
pnpm start      # node dist/…/server/server.mjs
```

## Project structure

```
src/
  main.ts               Browser bootstrap
  main.server.ts        Server bootstrap (used by @angular/ssr)
  app/
    app.component.ts    Root component (<router-outlet />)
    app.config.ts       Browser providers (router, httpClient, hydration)
    app.config.server.ts Server providers (provideServerRendering)
    app.routes.ts       Lazy-loaded routes: / /blog/:slug /admin
    pages/
      home.component.ts   Fetches /api/posts, renders post list
      blog.component.ts   Fetches /api/posts/:slug, renders post
      admin.component.ts  Loads Decap CMS from CDN via afterNextRender
  lib/
    laika.ts            createEmbeddedLaika singleton
    decap-config.ts     Decap collection schema
server.ts               Express + AngularNodeAppEngine + LaikaCMS proxy
angular.json            Angular CLI build configuration
content/posts/          Markdown content managed by Decap CMS
public/uploads/         Media uploads
```

## Key patterns

### Why `withFetch()` in `provideHttpClient`

Angular SSR renders components on the server. When `HttpClient.get('/api/posts')` runs during SSR,
Angular makes an HTTP request back to the same Express server. `withFetch()` replaces XHR with the
global `fetch` API, which works in Node.js (via the same Express server) but XHR does not.

### `afterNextRender` vs `ngOnInit` for client-only code

`ngOnInit` runs on both server and browser during SSR. For browser-only side effects (loading CDN
scripts, accessing `window`), use `afterNextRender` which is guaranteed to run only in the browser,
after the first render cycle.

### Express → Web API bridging

`laika.fetch` expects the WHATWG `Request` type. Express provides `IncomingMessage`. The
`toLaikaRequest` helper in `server.ts` reads the body stream and constructs a proper `Request`.
Frameworks that use Web API natively (Hono, Remix, Astro) don't need this bridge.
