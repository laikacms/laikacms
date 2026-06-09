# Packages

Laika CMS is published as four npm packages. Most functionality lives in `laikacms` as subpath
exports; specialized integrations live in their own packages.

## `laikacms`

The core package: domain types, API factories, default implementations, serializers, and shared
utilities. Imported via subpath exports.

### Domain (`packages/laikacms/src/domain/`)

| Subpath                         | Description                                    |
| ------------------------------- | ---------------------------------------------- |
| `laikacms/storage`              | Storage abstractions (objects, folders, atoms) |
| `laikacms/documents`            | Document management with revisions             |
| `laikacms/assets`               | Asset/media management                         |
| `laikacms/contentbase-settings` | ContentBase configuration                      |

### API (`packages/laikacms/src/api/`)

| Subpath                    | Description              |
| -------------------------- | ------------------------ |
| `laikacms/storage-api`     | JSON:API for storage     |
| `laikacms/documents-api`   | JSON:API for documents   |
| `laikacms/assets-api`      | JSON:API for assets      |
| `laikacms/contentbase-api` | JSON:API for ContentBase |

### Implementations (`packages/laikacms/src/impl/`)

| Subpath                                 | Description              |
| --------------------------------------- | ------------------------ |
| `laikacms/storage-r2`                   | Cloudflare R2 storage    |
| `laikacms/storage-fs`                   | Filesystem storage       |
| `laikacms/storage-drizzle`              | Drizzle ORM storage      |
| `laikacms/storage-jsonapi-proxy`        | Storage JSON:API proxy   |
| `laikacms/assets-r2`                    | R2 asset storage         |
| `laikacms/assets-jsonapi-proxy`         | Assets JSON:API proxy    |
| `laikacms/documents-drizzle`            | Drizzle document storage |
| `laikacms/documents-contentbase`        | ContentBase documents    |
| `laikacms/documents-jsonapi-proxy`      | Documents JSON:API proxy |
| `laikacms/contentbase-settings-default` | Default settings impl    |

### Serializers (`packages/laikacms/src/serializers/`)

| Subpath                                 | Description               |
| --------------------------------------- | ------------------------- |
| `laikacms/storage-serializers-json`     | JSON serialization        |
| `laikacms/storage-serializers-yaml`     | YAML serialization        |
| `laikacms/storage-serializers-markdown` | Markdown with frontmatter |
| `laikacms/storage-serializers-raw`      | Raw binary/text           |

### Shared (`packages/laikacms/src/shared/`)

| Subpath                   | Description              |
| ------------------------- | ------------------------ |
| `laikacms/core`           | Types, errors, utilities |
| `laikacms/crypto`         | Cryptographic utilities  |
| `laikacms/file-sanitizer` | File upload sanitization |
| `laikacms/i18n`           | Internationalization     |
| `laikacms/json-api`       | JSON:API utilities       |
| `laikacms/sanitizer`      | Input sanitization       |

## `@laikacms/aws`

AWS service implementations.

| Subpath                                  | Description                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `@laikacms/aws/contentbase-settings-ddb` | DynamoDB-backed contentbase settings                                                   |
| `@laikacms/aws/storage-s3`               | S3-backed StorageRepository (also works with MinIO, Backblaze B2, DigitalOcean Spaces) |
| `@laikacms/aws/storage-ddb`              | DynamoDB single-table StorageRepository                                                |
| `@laikacms/aws/assets-s3`                | S3-backed AssetsRepository                                                             |

## `@laikacms/decap`

Decap CMS integrations: backend, OAuth2, widgets, AI chat.

| Subpath                                                     | Description                     |
| ----------------------------------------------------------- | ------------------------------- |
| `@laikacms/decap/decap-cms-backend-laika`                   | Decap CMS backend               |
| `@laikacms/decap/decap-api`                                 | Decap-compatible API            |
| `@laikacms/decap/decap-oauth2`                              | OAuth2 server with PKCE         |
| `@laikacms/decap/decap-ai`                                  | AI integration server           |
| `@laikacms/decap/decap-cms-widget-ai-chat`                  | AI chat widget                  |
| `@laikacms/decap/decap-cms-widget-lucide-icon`              | Lucide icon picker              |
| `@laikacms/decap/decap-cms-widget-radix-icon`               | Radix icon picker               |
| `@laikacms/decap/decap-cms-locale-nl`                       | Dutch locale                    |
| `@laikacms/decap/decap-cms-editor-component-embedded-entry` | Embedded entry editor component |

## `@laikacms/github`

GitHub-backed `StorageRepository` (GitHub App authentication).

| Subpath                       | Description                      |
| ----------------------------- | -------------------------------- |
| `@laikacms/github/storage-gh` | GitHub-backed storage repository |

## `@laikacms/git-gateway`

Drop-in [Netlify git-gateway](https://github.com/netlify/git-gateway)-compatible HTTP handler. Lets
Decap CMS (configured with `backend: { name: git-gateway }`) talk to a fixed GitHub repo through a
GitHub App installation token, behind a pluggable Bearer-token verifier. Runtime-agnostic — runs on
Cloudflare Workers, Node, Bun, Deno, or anywhere Hono is supported.

| Subpath | Description                                   |
| ------- | --------------------------------------------- |
| `.`     | `gitGateway()` Hono app factory (root export) |

### `gitGateway(options)` options

| Option         | Type                                                 | Description                                                                        |
| -------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `verifyToken`  | `(token: string) => Promise<User \| null>`           | Validates the incoming Bearer token. Return `null` (or throw) to reject.           |
| `github`       | `{ appId, privateKey, installationId, owner, repo }` | GitHub App credentials targeting the fixed repository.                             |
| `allowedRoles` | `string[]` (optional)                                | When set, the user returned by `verifyToken` must have at least one matching role. |

### Endpoints

| Method | Path        | Auth | Description                                                                           |
| ------ | ----------- | ---- | ------------------------------------------------------------------------------------- |
| GET    | `/health`   | —    | Returns `{ ok: true }`. Cheap load-balancer health check.                             |
| GET    | `/settings` | ✓    | Returns `{ version, github_enabled, roles, user }`.                                   |
| ALL    | `/github/*` | ✓    | Proxies to `https://api.github.com/repos/{owner}/{repo}/*` via an installation token. |

The `/github/*` proxy allows only the same subset of endpoints as Netlify's gateway: `git/*`,
`contents/*`, `pulls/*`, `branches/*`, `merges/*`, `statuses/*`, `compare/*`, `commits/*`, and
`issues/:n/labels`. All other paths return `403 FORBIDDEN`.

### Usage

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
