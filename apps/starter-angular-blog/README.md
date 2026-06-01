# starter-angular-blog

Starter blog built with **Angular 19 SSR** + **LaikaCMS**. Demonstrates:

- `createEmbeddedLaika` mounted inside an **Express** server that also serves Angular's SSR.
- Blog pages as Angular standalone components reading content via `HttpClient` (`/api/posts`).
- An **absolute-URL interceptor** that makes Angular `HttpClient` work during server rendering
  (relative URLs don't resolve without a base URL in Node.js `fetch`).
- **`decapAdminHtml()`** — no esbuild step, no `public/admin/bundle.js` — just one function call in
  Express and the admin is served at `/admin`.

## Quick start

```bash
pnpm install
pnpm build        # ng build → browser + server bundles
pnpm start        # node dist/starter-angular-blog/server/server.mjs
```

Or for development with live reload:

```bash
pnpm dev          # ng serve — starts Angular dev server with SSR
```

Open <http://localhost:3000> (prod) or <http://localhost:4200> (dev) for the blog and
<http://localhost:3000/admin> for the Decap CMS editor.

## Project layout

```
angular.json           # Angular CLI workspace config (builder: @angular-devkit/build-angular:application)
tsconfig.json          # base TypeScript config for Angular 19 (TS 5.5 — not 6, which Angular 19 doesn't support)
tsconfig.app.json      # app-specific tsconfig
server.ts              # Express server: Decap API + blog JSON API + Angular SSR
src/
  index.html           # HTML shell (Angular injects into <app-root>)
  main.ts              # Browser bootstrap — bootstrapApplication(AppComponent, appConfig)
  main.server.ts       # Server bootstrap — uses app.config.server.ts (merged config)
  laika.ts             # createEmbeddedLaika singleton
  app/
    tokens.ts          # SERVER_ORIGIN injection token (passed via CommonEngine.render providers)
    app.component.ts   # Root component: just <router-outlet />
    app.config.ts      # Browser providers: router, HttpClient(withFetch), clientHydration
    app.config.server.ts # Server providers: provideServerRendering + HttpClient with interceptor
    app.routes.ts      # Routes: / → HomeComponent, /blog/:slug → PostComponent
    interceptors/
      base-url.interceptor.ts  # Prepends SERVER_ORIGIN to relative URLs during SSR
    services/
      blog.service.ts  # HttpClient wrapper for /api/posts and /api/posts/:slug
    pages/
      home/home.component.ts   # Blog index — ngOnInit calls blog.getPosts()
      post/post.component.ts   # Post detail — ngOnInit calls blog.getPost(slug)
content/               # Markdown content root (seeded by Decap CMS)
public/uploads/        # Media upload target
```

## Why a separate blog JSON API?

Angular's `HttpClient` is the canonical way to fetch data in Angular — both for the browser
(XHR/fetch) and for SSR (Node.js fetch). During SSR, Angular's zone waits for all pending HttpClient
requests to complete before serializing HTML, so the page is fully rendered on the server with real
content.

`laika.documents.*` is Node.js-only (`node:fs` / `node:path`). Importing it directly into an Angular
service would try to bundle it into the browser build. The clean boundary is:

- **Express routes** own `laika.documents.*` and expose a REST API (`/api/posts`,
  `/api/posts/:slug`).
- **Angular services** own `HttpClient` and know nothing about Node.js.

## The SSR base-URL interceptor

During SSR, `HttpClient.get('/api/posts')` sends a relative URL. Node.js `fetch` (used by Angular
with `withFetch()`) requires an absolute URL. The interceptor reads `SERVER_ORIGIN`
(`http://localhost:PORT`) from the DI tree and prepends it:

```ts
// app.config.server.ts
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideHttpClient(withFetch(), withInterceptors([absoluteUrlInterceptor])),
  ],
};
export const config = mergeApplicationConfig(appConfig, serverConfig);
```

`SERVER_ORIGIN` is injected by `CommonEngine.render()` at render time:

```ts
// server.ts
commonEngine.render({
  bootstrap,
  providers: [
    { provide: APP_BASE_HREF, useValue: baseUrl },
    { provide: SERVER_ORIGIN, useValue: `${protocol}://${headers['host']}` },
  ],
  ...
});
```

This token is never provided in the browser bootstrap — `inject(SERVER_ORIGIN, { optional: true })`
returns `null` and the interceptor is a no-op.

## TypeScript version

Angular 19 supports TypeScript 5.4–5.5. The workspace catalog pins `typescript` to v6 (for the core
packages). This starter explicitly pins `"typescript": "~5.5.4"` in `devDependencies` to satisfy
Angular's compiler-cli — pnpm isolates each package's `node_modules`, so both coexist without
conflicts.

**Doc gap fixed:** this incompatibility wasn't documented anywhere. Added a note above.

## Production hardening

| Area        | Starter default                 | Production recommendation                          |
| ----------- | ------------------------------- | -------------------------------------------------- |
| Auth        | `mode: 'dev'` (no password)     | `mode: 'custom'` with your own JWT/session check   |
| Storage     | Filesystem (`content/`)         | Persistent volume or swap to S3/R2/Drizzle storage |
| Decap CMS   | Loaded from CDN (unpkg/esm.sh)  | Self-host the bundle for SRI + no CDN dependency   |
| Angular SSR | `index.server.html` (disk read) | Edge caching in front of the Express server        |

## Framework adapter note

Express delivers `IncomingMessage` to route handlers; `laika.fetch` requires a WHATWG `Request`. See
`server.ts` for the full bridge used in the `/api/decap/*` route. The bridge follows the pattern
documented in `docs/decap-integration.md § Express / plain http.Server`.

Angular's built-in routes (`/`, `/blog/:slug`) use `HttpClient` which stays within Angular's world —
no bridging needed there.
