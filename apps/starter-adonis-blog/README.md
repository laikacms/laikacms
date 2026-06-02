# starter-adonis-blog

Minimal blog built with [AdonisJS 6](https://adonisjs.com) and LaikaCMS.

## Key integration points

- **AdonisJS-to-WHATWG bridge** — AdonisJS wraps Node.js `IncomingMessage`. The `toLaikaRequest`
  helper in `DecapController` converts the AdonisJS `HttpContext` to a WHATWG `Request` using
  `request.raw()` for the body (AdonisJS caches the raw body string before parsing, so it's
  available even after the bodyParser middleware runs).
- **`createEmbeddedLaika`** in `app/services/laika.ts` — singleton, imported by both controllers.
- **`laika.documents.*`** called directly in `BlogController` — no HTTP round-trip, no auth token
  needed for server-internal reads.
- **`decapAdminHtml()`** used in `DecapController.admin` — raw `response.send()` bypasses any
  AdonisJS view rendering. Decap CMS must own its own `<html>` document.

## Quick start

```bash
pnpm install
pnpm dev     # node ace serve --watch
```

Open <http://localhost:3333> for the blog and <http://localhost:3333/admin> for the CMS.

## Project layout

```
adonisrc.ts              # AdonisJS workspace config + providers
config/
  app.ts                 # HTTP config, app key, cookie settings
  logger.ts              # Pino logger config
start/
  routes.ts              # Route definitions
  kernel.ts              # Server middleware stack
  env.ts                 # Environment variable schema
app/
  controllers/
    decap_controller.ts  # Laika fetch proxy + admin shell
    blog_controller.ts   # Blog index and post pages (HTML templates)
  services/
    laika.ts             # createEmbeddedLaika singleton
    decap_config.ts      # Shared Decap CMS collection config
providers/
  app_provider.ts        # Minimal app provider
exceptions/
  handler.ts             # HTTP exception handler
content/
  posts/                 # Markdown files managed by Decap CMS
public/
  uploads/               # Media uploads (served as static files)
```

## AdonisJS-specific gotchas

### Body parser and raw body access

AdonisJS registers `@adonisjs/bodyparser` in `start/kernel.ts` by default. Unlike Express where
you must avoid `express.json()` before the Laika routes, AdonisJS caches the raw request body
in `request.raw()` _before_ parsing it. This means you can call `request.raw()` even after the
bodyParser has run.

**However**, this only works for text/JSON bodies. **Multipart upload requests** (Decap's media
upload endpoint) require the raw binary stream. For production use, either:
1. Disable the bodyParser for `/api/decap/*` via route-specific middleware.
2. Access the underlying Node.js request via `ctx.request.request` (the raw `IncomingMessage`).

See `app/controllers/decap_controller.ts` for the current approach and the comment about multipart.

### Path aliases

AdonisJS uses `#controllers/`, `#services/`, `#exceptions/` etc. as Node.js subpath imports
(defined in `package.json` via the `@adonisjs/assembler` build step). When building for production
(`node ace build`), the assembler rewrites these to relative paths.
