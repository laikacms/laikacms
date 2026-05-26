import { Hono } from 'hono';

/**
 * GitHub OAuth proxy for Decap CMS's `github` backend.
 *
 * The dance Decap implements (see `decap-cms-backend-github`'s
 * `AuthenticationPage`):
 *
 *   1. The CMS opens a popup at `/auth?provider=github&site_id=…&scope=…`.
 *   2. We 302 → GitHub's `/login/oauth/authorize` with our client id.
 *   3. GitHub redirects back to `/auth/callback?code=…`.
 *   4. We POST that code + our secret to GitHub's
 *      `/login/oauth/access_token`, get back `{ access_token, … }`.
 *   5. We respond with an HTML page that `postMessage`s
 *      `'authorization:github:success:{token,provider:"github"}'` to the
 *      opener window and closes itself.
 *
 * The matching opener-side listener is built into Decap; nothing else is
 * needed on the SPA.
 *
 * Set the two secrets with:
 *   wrangler secret put GITHUB_OAUTH_CLIENT_ID
 *   wrangler secret put GITHUB_OAUTH_CLIENT_SECRET
 *
 * In the GitHub OAuth app, the "Authorization callback URL" must match
 * `${origin}/auth/callback`.
 */

type Bindings = {
  GITHUB_OAUTH_CLIENT_ID: string,
  GITHUB_OAUTH_CLIENT_SECRET: string,
};

export const githubOAuthRouter = new Hono<{ Bindings: Bindings }>();

githubOAuthRouter.get('/', c => {
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  if (!clientId) return c.text('GITHUB_OAUTH_CLIENT_ID not configured', 500);
  const url = new URL(c.req.url);
  const scope = url.searchParams.get('scope') ?? 'repo,user';
  const redirectUri = `${url.origin}/auth/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
  });
  return c.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
});

githubOAuthRouter.get('/callback', async c => {
  const code = new URL(c.req.url).searchParams.get('code');
  if (!code) return c.text('Missing OAuth code in callback', 400);
  const clientId = c.env.GITHUB_OAUTH_CLIENT_ID;
  const clientSecret = c.env.GITHUB_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return c.text('GITHUB_OAUTH_CLIENT_ID/SECRET not configured', 500);
  }

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenRes.ok) {
    return c.text(`GitHub token exchange failed (${tokenRes.status})`, 502);
  }
  const tokenJson = (await tokenRes.json()) as { access_token?: string, error?: string };
  if (!tokenJson.access_token) {
    return c.text(`GitHub token exchange returned no access_token (error=${tokenJson.error ?? 'unknown'})`, 502);
  }

  const payload = JSON.stringify({ token: tokenJson.access_token, provider: 'github' });
  // Decap listens for `message` events whose data starts with
  // `authorization:<provider>:<status>:<json>`.
  const message = `authorization:github:success:${payload}`;
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Authorising…</title></head>
<body>
<p>Authorising… you can close this window.</p>
<script>
  (function () {
    var msg = ${JSON.stringify(message)};
    function send () {
      if (window.opener) {
        window.opener.postMessage(msg, '*');
      }
    }
    window.addEventListener('message', function (event) {
      if (event.data === 'authorizing:github') send();
    });
    send();
    setTimeout(function () { window.close(); }, 1000);
  })();
</script>
</body></html>`;
  return c.html(html);
});
