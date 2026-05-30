import { decapApi } from '@laikacms/decap-integrations/decap-api';
import { Hono } from 'hono';
import { AuthenticationError } from 'laikacms/core';

import type { Env } from './env.js';
import { reposForTenant } from './repos.js';

/**
 * Validate a Bearer GitHub user token via the regular GitHub `/user` endpoint
 * — same flow Decap CMS uses for `backend: github` and what ess-cms uses for
 * `backend: laika`. Returns the same `User` shape `@laikacms/decap` expects.
 */
const authenticateGithubUserToken = async (token: string) => {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'laika-gateway',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) {
    throw new AuthenticationError(
      `GitHub token validation failed (${res.status})`,
      { cause: res },
    );
  }
  const u = (await res.json()) as { id: number, login: string, email?: string | null, name?: string | null };
  return {
    id: String(u.id),
    email: u.email ?? `${u.login}@users.noreply.github.com`,
    name: u.name ?? u.login,
  };
};

export const githubRoutes = new Hono<{ Bindings: Env }>();

// ---- OAuth PKCE proxy ---------------------------------------------------
//
// Decap CMS (laika backend) does the auth dance in the SPA. We only need two
// thin proxies so the browser can complete the token exchange:
//   1. GET /github/oauth/authorize — top-level redirect into github.com.
//      The SPA tacks on `client_id`, `redirect_uri`, `state`,
//      `code_challenge`, etc. We forward as-is.
//   2. POST /github/oauth/access_token — token exchange. GitHub's endpoint
//      doesn't send CORS headers, so the SPA can't hit it directly.

githubRoutes.get('/oauth/authorize', c => {
  const url = new URL(c.req.url);
  // Inject our app's client_id and the `repo` scope so the SPA doesn't have
  // to ship them. Anything else the SPA passed (state, code_challenge, …)
  // we leave alone.
  url.searchParams.set('client_id', c.env.GITHUB_APP_CLIENT_ID);
  if (!url.searchParams.has('scope')) {
    url.searchParams.set('scope', 'repo');
  }
  return c.redirect(`https://github.com/login/oauth/authorize${url.search}`, 302);
});

githubRoutes.post('/oauth/access_token', async c => {
  let body: { code?: string, code_verifier?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.text('Invalid JSON body', 400);
  }
  const { code, code_verifier } = body;
  if (!code || !code_verifier) {
    return c.text('Missing code or code_verifier', 400);
  }
  const upstream = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    body: JSON.stringify({
      code,
      code_verifier,
      grant_type: 'authorization_code',
      client_id: c.env.GITHUB_APP_CLIENT_ID,
      client_secret: c.env.GITHUB_APP_CLIENT_SECRET,
    }),
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'laika-gateway',
    },
  });
  // RFC 6749 §5.1: token responses must carry `Cache-Control: no-store` so
  // intermediaries cannot cache (and later replay) the access token.
  return new Response(await upstream.text(), {
    status: upstream.status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Pragma': 'no-cache',
    },
  });
});

// ---- Per-tenant decap-api ---------------------------------------------
//
// Decap CMS hits this URL pattern:
//   /github/{owner}/{repo}/api/decap/...
// where {owner}/{repo} identifies the user's repo (which they installed our
// GitHub App on). We mint an installation token, build the laikacms repo
// bundle, hand it to `decapApi`, and forward the request.

githubRoutes.all('/:owner/:repo/api/decap/*', async c => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  if (!owner || !repo) return c.text('Missing owner/repo', 400);

  let bundle;
  try {
    bundle = await reposForTenant(c.env, { owner, repo });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The most common shape of failure here is "App is not installed on this
    // repo" — surface that clearly so the editor knows what to do.
    return c.json(
      { error: 'Could not resolve tenant. Has the GitHub App been installed on this repo?', detail: msg },
      404,
    );
  }

  const api = decapApi({
    documents: bundle.documents,
    storage: bundle.storage,
    assets: bundle.assets,
    basePath: `/github/${owner}/${repo}/api/decap`,
    authenticateAccessToken: authenticateGithubUserToken,
    logger: console,
  });
  return api.fetch(c.req.raw);
});
