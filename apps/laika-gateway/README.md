# laika-gateway

Hosted, multi-tenant Cloudflare Worker that backs the `laika` Decap CMS
backend. One GitHub App; many tenants. Users install the App on their own
repo and point Decap CMS at this gateway instead of standing up their own
Worker.

## URL layout

The backend name is the first path segment so other CMS sources can be added
later (`/gitlab/...`, etc.) without renaming anything.

| Method | Path                                          | What it does                                                                 |
| ------ | --------------------------------------------- | ---------------------------------------------------------------------------- |
| GET    | `/`                                           | Service info (`{ service, version, backends }`).                             |
| GET    | `/health`                                     | Cheap health check.                                                          |
| GET    | `/github/oauth/authorize`                     | Top-level GitHub PKCE redirect. The SPA supplies `state` + `code_challenge`. |
| POST   | `/github/oauth/access_token`                  | PKCE token exchange (CORS workaround — github.com doesn't return CORS).      |
| ALL    | `/github/{owner}/{repo}/api/decap/*`          | Per-tenant Decap API. Mints an installation token on demand.                 |

## Decap CMS config (tenant side)

```yaml
backend:
  name: laika
  base_url: https://gateway.laikacms.com
  auth_endpoint: github/oauth/authorize
  auth_token_endpoint: github/oauth/access_token
  api_root: /github/{owner}/{repo}/api/decap
  app_id: <github-app-client-id>
```

By convention each tenant repo keeps its Decap config at `public/config.yaml`.
The gateway's `DecapContentBaseSettingsProvider` reads it from there per
request.

## How tenant routing works

1. Browser hits `/github/{owner}/{repo}/api/decap/...` with a Bearer GitHub
   user token (from PKCE).
2. The gateway looks up the GitHub App's installation on `{owner}/{repo}` via
   `octokit.apps.getRepoInstallation` — cached per worker isolate.
3. A `GithubStorageRepository` is built for that installation; the
   `ContentBase*` repos wrap it; `decapApi` handles the rest.
4. The user's token is validated against `api.github.com/user` (same flow
   `backend: github` uses), then forwarded as `authenticateAccessToken`.

If step 2 fails (App not installed on the repo), the gateway responds 404
with a clear message so the editor knows what to do.

## Setup

### One-time: GitHub App

1. Create a GitHub App with these permissions:
   - **Repository**: Contents (read/write), Metadata (read), Pull requests
     (read/write) if you want unpublished entries.
2. Generate a private key, note the App id + client id + client secret.
3. Set the OAuth redirect URL to wherever the SPA lives, e.g.
   `https://my-site.com/admin/`.

### Deploy

```sh
cd apps/laika-gateway
wrangler secret put GITHUB_APP_ID
wrangler secret put GITHUB_APP_PRIVATE_KEY
wrangler secret put GITHUB_APP_CLIENT_ID
wrangler secret put GITHUB_APP_CLIENT_SECRET
wrangler secret put PUBLIC_URL   # e.g. https://gateway.laikacms.com
wrangler deploy
```

### Per tenant

The user just needs to:

1. Install the GitHub App on their repo.
2. Commit a `public/config.yaml` with the Decap config above.
3. Open the Decap admin and log in.

No per-tenant deployment.

## Local dev

```sh
pnpm dev   # wrangler dev on :8787
```

Fill `.dev.vars` with real-or-stub values; the gateway still boots with empty
strings but every GitHub call will of course fail.
