/**
 * laika-gateway — hosted multi-tenant Worker that lets anyone use the laika
 * Decap CMS backend without standing up their own Worker. A single GitHub
 * App; tenants install it on their own repo; we mint per-tenant installation
 * tokens on demand.
 *
 * URL layout — backend is the first path segment so we can add `/gitlab/...`
 * etc. later without renaming anything:
 *
 *   GET  /github/oauth/authorize              top-level GitHub PKCE redirect
 *   POST /github/oauth/access_token           PKCE token exchange (CORS workaround)
 *   ALL  /github/{owner}/{repo}/api/decap/*   per-tenant decap-api
 *
 * The Decap CMS config on the tenant's side then looks like:
 *
 *   backend:
 *     name: laika
 *     base_url: https://gateway.laikacms.com
 *     auth_endpoint: github/oauth/authorize
 *     auth_token_endpoint: github/oauth/access_token
 *     api_root: /github/{owner}/{repo}/api/decap
 *     app_id: <github-app-client-id>
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';

import type { Env } from './env.js';
import { githubRoutes } from './github-routes.js';

const app = new Hono<{ Bindings: Env }>();

// The gateway is multi-tenant: Decap CMS SPAs running on arbitrary tenant
// domains hit these routes cross-origin. Auth is via Bearer token (never
// cookies), so wildcard origin + no credentials is the right shape.
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With'],
    exposeHeaders: ['Content-Length', 'Content-Type'],
    maxAge: 86400,
  }),
);

app.get('/', c =>
  c.json({
    service: 'laika-gateway',
    version: '0.1.2',
    backends: ['github'],
  }));

app.get('/health', c => c.json({ ok: true }));

app.route('/github', githubRoutes);

export default app;
