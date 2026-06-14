# @laikacms/git-gateway

Drop-in [Netlify git-gateway](https://github.com/netlify/git-gateway)-compatible HTTP handler. Lets
Decap CMS (and the legacy Netlify CMS) talk to a fixed GitHub repo through a GitHub App, behind a
pluggable Bearer-token verifier.

## Why

Decap CMS configured with `backend: { name: git-gateway }` expects a service that:

1. Validates a Bearer token (originally Netlify Identity JWTs).
2. Proxies a tightly-scoped subset of GitHub's REST API to a fixed repo.
3. Exposes a small `/settings` document so the editor knows what's available.

This package is that service, minus the AWS-Cognito / Netlify-Identity vendor lock-in. You bring the
token verifier; the package handles GitHub App auth + endpoint allow-listing + response header
filtering.

## Usage

```ts
import { gitGateway } from '@laikacms/git-gateway';
import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.route(
  '/.netlify/git',
  gitGateway({
    // Validate the incoming Bearer. Throw or return null to reject. The
    // returned user shape is surfaced on /settings and used for role checks.
    verifyToken: async token => {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `token ${token}`, 'User-Agent': 'gg' },
      });
      if (!r.ok) return null;
      const u = await r.json();
      return { id: String(u.id), email: u.email, name: u.name };
    },
    github: {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
      installationId: env.GITHUB_APP_INSTALLATION_ID,
      owner: 'acme',
      repo: 'website',
    },
  }),
);

export default app;
```

Then in your Decap CMS config:

```yaml
backend:
  name: git-gateway
  gateway_url: https://your-worker.dev/.netlify/git
```

## Options

| Option         | Type                                                               | Description                                                                              |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `verifyToken`  | `(token: string) => Promise<User \| null>`                         | Validates the incoming Bearer token. Return `null` (or throw) to reject.                 |
| `github`       | `{ appId, privateKey, installationId, owner, repo, apiBase? }`     | GitHub App credentials. `apiBase` defaults to `https://api.github.com` (useful for GHE). |
| `allowedRoles` | `string[]` (optional)                                              | When set, the user returned by `verifyToken` must have at least one matching role.       |
| `logger`       | `Pick<Console, 'error' \| 'warn' \| 'info' \| 'debug'>` (optional) | Pluggable structured logger (pino, bunyan, etc.). Defaults to a no-op.                   |
| `userAgent`    | `string` (optional)                                                | Custom User-Agent for outgoing GitHub API requests. Defaults to `@laikacms/git-gateway`. |

## Endpoints

| Method | Path        | Auth | Notes                                                                                   |
| ------ | ----------- | ---- | --------------------------------------------------------------------------------------- |
| GET    | `/health`   | —    | `{ ok: true }`. Cheap load-balancer health check.                                       |
| GET    | `/settings` | ✓    | Returns `{ version, github_enabled, roles, user }`.                                     |
| ALL    | `/github/*` | ✓    | Proxies to `https://api.github.com/repos/{owner}/{repo}/*` using an installation token. |

`/github/*` only lets through endpoints that match the same allow-list as Netlify's gateway:
`git/*`, `contents/*`, `statuses/*`, `compare/*`, `issues/:n/labels`, and `issues/:n/labels/:name`
(for specific label removal via DELETE). Anything else returns `403 FORBIDDEN`.

For `pulls`, `branches`, `merges`, and `commits` the allow-list uses a `(\/|$|\?)` pattern, so bare
collection endpoints and query-string variants are also proxied:

| Pattern matched                        | Examples                                                              |
| -------------------------------------- | --------------------------------------------------------------------- |
| `pulls`, `pulls/*`, `pulls?…`          | `GET /pulls`, `GET /pulls/123`, `GET /pulls?state=open`               |
| `branches`, `branches/*`, `branches?…` | `GET /branches`, `GET /branches/main`, `GET /branches?protected=true` |
| `merges`, `merges/*`, `merges?…`       | `POST /merges`, `GET /merges/abc`                                     |
| `commits`, `commits/*`, `commits?…`    | `GET /commits`, `GET /commits/abc123`, `GET /commits?sha=main`        |

Decap CMS relies on `GET /pulls` (no sub-path) to list editorial PRs, so the bare-collection form
must be allowed.

## Role-based access

Optional. If you pass `allowedRoles: ['editor']`, the user returned by `verifyToken` must have at
least one matching role:

```ts
gitGateway({
  verifyToken: async (token) => ({
    id: '…',
    roles: await rolesFor(token),
  }),
  allowedRoles: ['editor'],
  github: { ... },
});
```

## Notes

- The GitHub installation token is cached in-memory and refreshed ~1 minute before GitHub's stated
  expiry.
- The handler is a [Hono](https://hono.dev) app, so it runs in Cloudflare Workers, Node, Bun, Deno,
  or anywhere Hono is supported.
- The proxy strips GitHub's `Access-Control-*` headers from upstream responses — set your own CORS
  layer at the host app level.
