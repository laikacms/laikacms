/**
 * Drop-in Netlify git-gateway compatible HTTP handler.
 *
 * Decap CMS (and the legacy Netlify CMS) can be configured with
 * `backend: { name: git-gateway }`. That backend talks to a gateway service
 * that:
 *   - serves a small `/settings` document describing what's available,
 *   - validates a Bearer token (originally from Netlify Identity),
 *   - proxies a tightly-scoped subset of GitHub's REST API to a fixed repo.
 *
 * This package exports a runtime-agnostic Hono app that satisfies that
 * contract. The Identity piece is intentionally pluggable: pass any
 * `verifyToken` function — JWT verifier, GitHub `/user` checker, in-memory
 * map for tests, etc.
 *
 * @example
 * ```ts
 * import { Hono } from 'hono';
 * import { gitGateway } from '@laikacms/git-gateway';
 *
 * const app = new Hono<{ Bindings: Env }>();
 * app.route('/.netlify/git', gitGateway({
 *   verifyToken: async (token) => {
 *     // Validate a GitHub user token against api.github.com/user
 *     const r = await fetch('https://api.github.com/user', {
 *       headers: { Authorization: `token ${token}`, 'User-Agent': 'gg' },
 *     });
 *     if (!r.ok) return null;
 *     const u = await r.json();
 *     return { id: String(u.id), email: u.email, name: u.name };
 *   },
 *   github: {
 *     appId: env.GITHUB_APP_ID,
 *     privateKey: env.GITHUB_APP_PRIVATE_KEY,
 *     installationId: env.GITHUB_APP_INSTALLATION_ID,
 *     owner: 'acme',
 *     repo: 'website',
 *   },
 * }));
 * export default app;
 * ```
 *
 * Then in your Decap config:
 * ```yaml
 * backend:
 *   name: git-gateway
 *   gateway_url: https://your-worker.dev/.netlify/git
 * ```
 */
import { type Context, Hono, type Next } from 'hono';

import { InstallationTokenSource, isAllowedGithubPath, proxyToGithub } from './github.js';
import type { GatewayUser, GitGatewayOptions } from './types.js';

export type { GatewayUser, GitGatewayOptions, GitHubAppCreds, GitHubTarget, VerifyToken } from './types.js';

const DEFAULT_USER_AGENT = '@laikacms/git-gateway';

type Variables = { user: GatewayUser };

const noopLogger = { error() {}, warn() {}, info() {}, debug() {} };

export const gitGateway = (options: GitGatewayOptions): Hono<{ Variables: Variables }> => {
  const logger = options.logger ?? noopLogger;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  const tokenSource = new InstallationTokenSource(options.github);

  const app = new Hono<{ Variables: Variables }>();

  // GET /health — public; intentionally returns a tiny payload so a load
  // balancer can hit it cheaply.
  app.get('/health', c => c.json({ ok: true }));

  // Auth gate for everything else.
  const authGate = async (c: Context<{ Variables: Variables }>, next: Next) => {
    if (c.req.method === 'OPTIONS') return next();
    const header = c.req.header('Authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Missing Bearer token' } }, 401);
    }
    let user: GatewayUser | null;
    try {
      user = await options.verifyToken(match[1]!);
    } catch (err) {
      logger.warn?.('git-gateway: verifyToken threw', err);
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401);
    }
    if (!user) {
      return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } }, 401);
    }
    if (options.allowedRoles && options.allowedRoles.length > 0) {
      const userRoles = user.roles ?? [];
      const ok = userRoles.some(r => options.allowedRoles!.includes(r));
      if (!ok) {
        return c.json({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } }, 403);
      }
    }
    c.set('user', user);
    await next();
  };

  app.use('/settings', authGate);
  app.use('/github/*', authGate);

  // GET /settings — Decap CMS reads this to confirm what's available.
  // Per-user response (carries roles + identity), so opt out of caching to
  // avoid stale role/permission state surviving across user changes.
  app.get('/settings', c => {
    const user = c.get('user');
    c.header('Cache-Control', 'no-store');
    return c.json({
      version: '1.0.0',
      github_enabled: true,
      // Decap reads `roles` to compare against `auth_endpoint_role_field`.
      roles: user.roles ?? [],
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  });

  // ALL /github/* — proxy to a fixed GitHub repo through an App installation token.
  app.all('/github/*', async c => {
    const fullPath = new URL(c.req.url).pathname;
    // Strip whatever prefix the parent app mounted us under, then `/github`.
    const idx = fullPath.indexOf('/github/');
    if (idx === -1) {
      return c.json({ error: { code: 'NOT_FOUND', message: 'Unknown path' } }, 404);
    }
    const subpath = fullPath.slice(idx + '/github'.length); // includes the leading '/'
    if (!isAllowedGithubPath(subpath)) {
      logger.warn?.('git-gateway: denied GitHub endpoint', { subpath });
      return c.json(
        { error: { code: 'FORBIDDEN', message: 'Endpoint not allowed' } },
        403,
      );
    }
    try {
      return await proxyToGithub(c.req.raw, subpath, {
        tokenSource,
        target: options.github,
        userAgent,
      });
    } catch (err) {
      logger.error?.('git-gateway: proxy failed', err);
      const message = err instanceof Error ? err.message : String(err);
      return c.json(
        { error: { code: 'GITHUB_ERROR', message } },
        502,
      );
    }
  });

  return app;
};
