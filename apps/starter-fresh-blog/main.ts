/**
 * Fresh 2 blog server.
 *
 * Fresh is Deno's official full-stack web framework, published on JSR as
 * jsr:@fresh/core. It uses Preact for server-rendered components, an islands
 * architecture for client-side interactivity, and file-based routing via a
 * `routes/` directory.
 *
 * Bridging Fresh → laika.fetch
 * ────────────────────────────
 * Fresh 2 routes receive a FreshContext whose `.req` property IS the native
 * WHATWG Request — identical to Hono's `c.req.raw`. So the proxy is a single
 * line with no bridging:
 *
 *   export const handler = define.handlers((ctx) => laika.fetch(ctx.req));
 *
 * Compare to Oak (`ctx.request.original`) or Express (full IncomingMessage
 * → Request adapter).
 *
 * File-based routing
 * ──────────────────
 * Fresh 2 discovers routes from the `routes/` directory at startup via
 * `app.fsRoutes()`. No code-generation step is required — Fresh uses dynamic
 * import() to load route modules at startup.
 *
 * Running
 * ───────
 * `deno serve main.ts` starts the server. Fresh exports the App instance
 * as default; deno serve calls `.fetch(req)` on it for each request.
 *
 * Required Deno permissions (set in deno.json tasks):
 *   --allow-net   HTTP server + outbound fetch
 *   --allow-read  Read routes/, content/, and public/ directories
 *   --allow-write Write content/ files (Decap CRUD)
 *   --allow-env   Read PORT env var
 */
import { App, staticFiles } from 'fresh';

const app = new App()
  .use(staticFiles())
  .fsRoutes();

export default app;
