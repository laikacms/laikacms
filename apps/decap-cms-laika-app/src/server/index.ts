import { Hono } from 'hono';

import { githubOAuthRouter } from './auth';

/**
 * Cloudflare Worker entry for the Laika CMS app.
 *
 * Two responsibilities:
 *
 *   1. Serve the GitHub OAuth dance for Decap CMS at `/auth/*`. Decap's
 *      `github` backend opens a popup at this URL; the worker redirects to
 *      GitHub, receives the code, exchanges it for a token, and posts the
 *      token back to the opener window. The credentials live in Wrangler
 *      secrets (`GITHUB_OAUTH_CLIENT_ID` + `GITHUB_OAUTH_CLIENT_SECRET`).
 *
 *   2. Tiny health/util endpoints under `/api/*` for uptime probes.
 *
 * Everything else falls through to `env.ASSETS` — the SPA bundle.
 */
type Env = {
  ASSETS: Fetcher,
  GITHUB_OAUTH_CLIENT_ID: string,
  GITHUB_OAUTH_CLIENT_SECRET: string,
};

const app = new Hono<{ Bindings: Env }>();

app.route('/auth', githubOAuthRouter);

app.get('/api/health', c => c.json({ ok: true, app: 'decap-cms-laika-app' }));

// Anything that didn't match a server route is the SPA — defer to the
// static asset binding. `wrangler.toml` already declares
// `not_found_handling = "single-page-application"` so deep links to
// e.g. `/admin/foo` serve `index.html`.
app.all('*', c => c.env.ASSETS.fetch(c.req.raw));

export default app;
