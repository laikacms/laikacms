# Git Gateway

A drop-in replacement for [Netlify's git-gateway](https://github.com/netlify/git-gateway). Decap CMS
configured with `backend: { name: git-gateway }` talks to a fixed GitHub repository through a GitHub
App installation token, behind a Bearer-token check you supply. It runs on Cloudflare Workers,
Node.js, Bun, Deno, or anywhere else [Hono](https://hono.dev) runs.

```bash
pnpm add @laikacms/git-gateway hono
```

```typescript
import { gitGateway } from '@laikacms/git-gateway';
```

`gitGateway()` returns a Hono app to mount in your own.

## Options

| Option         | Type                                                           | Description                                                                                                                                   |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifyToken`  | `(token: string) => Promise<User \| null>`                     | Validates the incoming Bearer token. Return `null` (or throw) to reject.                                                                      |
| `github`       | `{ appId, privateKey, installationId, owner, repo, apiBase? }` | GitHub App credentials. `apiBase` defaults to `https://api.github.com` (useful for GHE).                                                      |
| `allowedRoles` | `string[]` (optional)                                          | When set, the user returned by `verifyToken` must have at least one matching role.                                                            |
| `logger`       | `{ error, warn, info?, debug? }` (optional)                    | Pluggable structured logger (pino, bunyan, etc.). Only `error` and `warn` are required; `info` and `debug` are optional. Defaults to a no-op. |
| `userAgent`    | `string` (optional)                                            | Custom User-Agent for outgoing GitHub API requests. Defaults to `@laikacms/git-gateway`.                                                      |

## Endpoints

| Method | Path        | Auth | Description                                                                           |
| ------ | ----------- | ---- | ------------------------------------------------------------------------------------- |
| GET    | `/health`   | —    | Returns `{ ok: true }`. Cheap load-balancer health check.                             |
| GET    | `/settings` | ✓    | Returns `{ version, github_enabled, roles, user }`.                                   |
| ALL    | `/github/*` | ✓    | Proxies to `https://api.github.com/repos/{owner}/{repo}/*` via an installation token. |

The `/github/*` proxy allows only the same subset of endpoints as Netlify's gateway: `git/*`,
`contents/*`, `pulls/*`, `branches/*`, `merges/*`, `statuses/*`, `compare/*`, `commits/*`, and
`issues/:n/labels`. All other paths return `403 FORBIDDEN`.

## Usage

Mount it inside an existing Hono app:

```ts
import { gitGateway } from '@laikacms/git-gateway';
import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.route(
  '/.netlify/git',
  gitGateway({
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
```

Then in your Decap CMS config:

```yaml
backend:
  name: git-gateway
  gateway_url: https://your-worker.dev/.netlify/git
```
