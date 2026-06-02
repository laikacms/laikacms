# starter-angular-blog

Minimal blog built with [Angular 21](https://angular.dev) (SSR via `@angular/ssr`) and LaikaCMS.

## Key integration points

- **`createEmbeddedLaika`** in `server.ts` — the Express server that Angular CLI generates for SSR
  is extended with Laika/Decap routes before the Angular `CommonEngine` catch-all.
- **JSON API pattern** — `server.ts` exposes `/api/posts` and `/api/posts/:slug` endpoints that call
  `laika.documents.*` directly. Angular's `HttpClient` calls these from both SSR and browser
  contexts. This avoids importing Effect-based code into the Angular bundle.
- **`SERVER_URL` injection token** — on the server, `global fetch()` requires an absolute URL.
  `server.ts` injects `SERVER_URL = "http://localhost:<port>"` at render time; the browser
  gets `null` (falls back to relative URL `""`). This pattern differs from the SvelteKit/Nuxt
  starters that have built-in server fetch helpers.
- **`withHttpTransferCache()`** — Angular serialises HTTP responses made during SSR and replays
  them in the browser, so no duplicate `/api/posts` fetch occurs on hydration.
- **`decapAdminHtml()`** — `/admin` is served by Express before Angular's catch-all. Angular
  must not hydrate the Decap CMS shell. Serving it from a plain Express route prevents Angular
  from touching it.

## Quick start

```bash
pnpm install
pnpm dev      # angular dev server with SSR (ng serve)
```

Open <http://localhost:4200> for the blog and <http://localhost:4200/admin> for the CMS.

To build for production:

```bash
pnpm build
pnpm start   # node dist/server/server.mjs
```

## Project layout

```
angular.json           # Angular CLI workspace config
tsconfig.json
tsconfig.app.json
server.ts              # Express server — LaikaCMS + Angular CommonEngine SSR
src/
  index.html           # App shell (<app-root> placeholder)
  main.ts              # Browser bootstrap
  main.server.ts       # SSR bootstrap (merges appConfig + serverConfig)
  app/
    app.component.ts   # Root component (<router-outlet>)
    app.config.ts      # Browser providers (HttpClient, Router, ClientHydration)
    app.config.server.ts # SSR-only providers (provideServerRendering)
    app.routes.ts      # Route definitions (lazy-loaded components)
    services/
      posts.service.ts # HttpClient calls to /api/posts (handles SSR URL)
    pages/
      home/            # Blog index — lists posts from /api/posts
      post/            # Post detail — fetches from /api/posts/:slug
content/
  posts/               # Markdown files managed by Decap CMS
public/
  uploads/             # Media uploads
```

## Angular-specific gotchas

### Body parser conflict

Angular's SSR Express server must not use `express.json()` or `bodyParser` in front of
`/api/decap/*`. The Express-to-WHATWG adapter in `server.ts` reads the raw body stream; a body
parser would drain it first. This is the same constraint as `starter-express-blog`.

### Absolute URLs in SSR

Angular's `HttpClient` with `withFetch()` uses the global `fetch()`, which in Node.js requires
absolute URLs. The `SERVER_URL` injection token pattern shown here is the idiomatic way to handle
this; alternatives include `REQUEST` token inspection or a custom `HttpInterceptor`.

### Decap admin isolation

Angular hydrates the entire `<html>` document. Serving `/admin` as a plain Express response
(before the Angular `CommonEngine` handler) keeps Decap out of Angular's hydration boundary.
The `decapAdminHtml()` helper generates the complete standalone page.

### Build output paths

The Angular build outputs:
- `dist/browser/` — client bundle, served as static files
- `dist/server/server.mjs` — compiled server entry point

In development (`ng serve`), Angular Dev Server handles SSR in memory — `dist/` is not written.
