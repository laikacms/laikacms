# Packages

Most functionality lives in `laikacms` as subpath exports; specialized integrations live in their
own packages.

> **Repository layout (June 2026).** This monorepo now carries only the three core packages —
> `laikacms`, `@laikacms/decap`, and `@laikacms/decap-ai`. The other packages documented below
> (`@laikacms/aws`, `@laikacms/github`, `@laikacms/git-gateway`, `laikacli`,
> `decap-cms-widget-lexicaleditor`, `decap-cms-widget-portabletext-editor`,
> `decap-cms-lexical-core`, and the rest of the adapters) are still published to npm under the same
> names but are now developed in **separate repositories**. See
> [the restructure note](./restructure-2026-06.md) for details and the current status of the moved
> repos.

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

| Subpath                                 | Description                                                                                                                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/storage-r2`                   | Cloudflare R2 storage                                                                                                                                                              |
| `laikacms/storage-fs`                   | Filesystem storage                                                                                                                                                                 |
| `laikacms/storage-s3`                   | S3→R2Bucket adapter (`createS3Bucket()`) — pairs with `R2StorageRepository`, not a `StorageRepository` itself. See `@laikacms/aws/storage-s3` for the full S3 `StorageRepository`. |
| `laikacms/storage-webdav`               | WebDAV server                                                                                                                                                                      |
| `laikacms/storage-drizzle`              | Drizzle ORM storage                                                                                                                                                                |
| `laikacms/storage-jsonapi-proxy`        | Storage JSON:API proxy                                                                                                                                                             |
| `laikacms/assets-r2`                    | R2 asset storage                                                                                                                                                                   |
| `laikacms/assets-contentbase`           | Assets on top of storage                                                                                                                                                           |
| `laikacms/assets-obsidian`              | Obsidian-vault-backed assets                                                                                                                                                       |
| `laikacms/assets-jsonapi-proxy`         | Assets JSON:API proxy                                                                                                                                                              |
| `laikacms/documents-contentbase`        | Documents on top of storage                                                                                                                                                        |
| `laikacms/documents-drizzle`            | Drizzle document storage                                                                                                                                                           |
| `laikacms/documents-obsidian`           | Obsidian-vault-backed documents                                                                                                                                                    |
| `laikacms/documents-jsonapi-proxy`      | Documents JSON:API proxy                                                                                                                                                           |
| `laikacms/contentbase-settings-default` | Default settings impl                                                                                                                                                              |
| `laikacms/contentbase-settings-decap`   | Decap-CMS-compatible settings                                                                                                                                                      |

### Testing utilities (`packages/laikacms/src/`)

| Subpath                      | Description                                                     |
| ---------------------------- | --------------------------------------------------------------- |
| `laikacms/documents/testing` | Contract test harness for `DocumentsRepository` implementations |
| `laikacms/storage/testing`   | Contract test harness for `StorageRepository` implementations   |
| `laikacms/assets/testing`    | Contract test harness for `AssetsRepository` implementations    |

### Serializers (`packages/laikacms/src/serializers/`)

| Subpath                                 | Description               |
| --------------------------------------- | ------------------------- |
| `laikacms/storage-serializers-json`     | JSON serialization        |
| `laikacms/storage-serializers-yaml`     | YAML serialization        |
| `laikacms/storage-serializers-markdown` | Markdown with frontmatter |
| `laikacms/storage-serializers-raw`      | Raw binary/text           |

### Shared (`packages/laikacms/src/shared/`)

| Subpath                   | Description                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/compat`         | Promise-bridge helpers (`runTask`, `collectStream`) for consuming `LaikaTask`/`LaikaStream` without importing `effect` directly |
| `laikacms/core`           | Types, errors, utilities                                                                                                        |
| `laikacms/crypto`         | Cryptographic utilities                                                                                                         |
| `laikacms/file-sanitizer` | File upload sanitization                                                                                                        |
<<<<<<< HEAD
| `laikacms/i18n`           | Internationalization                                                                                                            |
| `laikacms/i18n/en`        | English UI strings                                                                                                              |
| `laikacms/i18n/nl`        | Dutch UI strings                                                                                                                |
=======
| `laikacms/i18n`           | Internationalization (bundle index)                                                                                             |
| `laikacms/i18n/en`        | English translations                                                                                                            |
| `laikacms/i18n/nl`        | Dutch translations                                                                                                              |
>>>>>>> af86c702 (docs(LCMS-198, LCMS-242): fix README gaps — assets-obsidian options, documents-obsidian, decap-ai, domain READMEs)
| `laikacms/json-api`       | JSON:API utilities                                                                                                              |
| `laikacms/sanitizer`      | Input sanitization                                                                                                              |

## `@laikacms/aws`

AWS service implementations.

| Subpath                                  | Description                                                                            |
| ---------------------------------------- | -------------------------------------------------------------------------------------- |
| `@laikacms/aws/contentbase-settings-ddb` | DynamoDB-backed contentbase settings                                                   |
| `@laikacms/aws/storage-s3`               | S3-backed StorageRepository (also works with MinIO, Backblaze B2, DigitalOcean Spaces) |
| `@laikacms/aws/storage-ddb`              | DynamoDB single-table StorageRepository                                                |
| `@laikacms/aws/assets-s3`                | S3-backed AssetsRepository                                                             |

## `@laikacms/decap-ai`

AI chat integration for Decap CMS. Bundles the Vercel AI SDK so consumers share one `ai` runtime.
Provides a runtime-agnostic server adapter, a React widget, and document-manipulation tools.

| Subpath                                | Description                                                                             |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `@laikacms/decap-ai`                   | `decapAi()` server adapter factory + Vercel AI SDK re-exports (`tool`, `streamText`, …) |
| `@laikacms/decap-ai/tools`             | Built-in client-side document tools (`getDocumentData`, `updateDocument`)               |
| `@laikacms/decap-ai/providers`         | Model provider re-exports (`anthropic`, `openai` and their factories)                   |
| `@laikacms/decap-ai/widget`            | React widget (`WidgetAiChat`, `AiChatControl`, `AiChatPreview`, `useChat`)              |
| `@laikacms/decap-ai/widget/i18n/types` | TypeScript types for widget translation strings                                         |
| `@laikacms/decap-ai/widget/i18n/en`    | English widget UI strings                                                               |
| `@laikacms/decap-ai/widget/i18n/nl`    | Dutch widget UI strings                                                                 |
| `@laikacms/decap-ai/i18n/types`        | TypeScript types for server-side translation strings                                    |
| `@laikacms/decap-ai/i18n/en`           | English server-side strings (errors + default system prompt)                            |
| `@laikacms/decap-ai/i18n/nl`           | Dutch server-side strings                                                               |

## `@laikacms/decap`

Decap CMS integrations: backend, OAuth2, widgets, server adapters. AI chat lives in the separate
`@laikacms/decap-ai` package.

| Subpath                                                     | Description                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `@laikacms/decap/decap-cms-backend-laika`                   | Decap CMS backend                                                |
| `@laikacms/decap/decap-api`                                 | Decap-compatible API                                             |
| `@laikacms/decap/decap-oauth2`                              | OAuth2 server with PKCE                                          |
<<<<<<< HEAD
| `@laikacms/decap/decap-oauth2/i18n`                         | OAuth2 i18n translations (types, defaults)                       |
| `@laikacms/decap/decap-oauth2/i18n/en`                      | English OAuth2 UI strings                                        |
| `@laikacms/decap/decap-oauth2/i18n/nl`                      | Dutch OAuth2 UI strings                                          |
=======
| `@laikacms/decap/decap-oauth2/i18n`                         | i18n bundle index for the OAuth2 UI                              |
| `@laikacms/decap/decap-oauth2/i18n/en`                      | English translations for the OAuth2 UI                           |
| `@laikacms/decap/decap-oauth2/i18n/nl`                      | Dutch translations for the OAuth2 UI                             |
>>>>>>> af86c702 (docs(LCMS-198, LCMS-242): fix README gaps — assets-obsidian options, documents-obsidian, decap-ai, domain READMEs)
| `@laikacms/decap/decap-cms-widget-lucide-icon`              | Lucide icon picker                                               |
| `@laikacms/decap/decap-cms-widget-radix-icon`               | Radix icon picker                                                |
| `@laikacms/decap/decap-cms-locale-nl`                       | Dutch locale                                                     |
| `@laikacms/decap/decap-cms-editor-component-embedded-entry` | Embedded entry editor component                                  |
| `@laikacms/decap/decap-config-types`                        | TypeScript type utilities derived from a Decap CMS config object |

## `decap-cms-lexical-core`

> **Developed in a separate repository** (moved out June 2026). Still published to npm under the
> same name. See [the restructure note](./restructure-2026-06.md).

Lexical-specific bindings for the editor-agnostic `@laikacloud/portabletext-core`: Portable Text ↔
Lexical bridge, headless editor factory, custom blocks subsystem, and the `LexicalRichtextValue`
class that derives canonical Portable Text from a Lexical editor state on every change.

### Install

```bash
pnpm add decap-cms-lexical-core
```

### Main exports

| Export                                          | Description                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| `LexicalRichtextValue`                          | `RichtextValue` subclass that owns a Lexical `EditorState` and produces Portable Text |
| `createHeadlessEditor()`                        | Creates a Lexical headless editor with the standard node set pre-registered           |
| `defaultNodes`                                  | Array of Lexical `EditorNode` constructors used by the standard headless editor       |
| `lexicalToPortableText()`                       | Convert a Lexical `EditorState` to a `PortableTextDocument`                           |
| `portableTextToLexical()`                       | Populate a Lexical editor from a `PortableTextDocument`                               |
| `emptyPortableText()`                           | Returns a minimal valid empty `PortableTextDocument`                                  |
| `BlockNode` / `blocksContext`                   | Custom block subsystem for embedding arbitrary Decap entries inside Lexical           |
| Everything from `@laikacloud/portabletext-core` | Re-exported for convenience (`Mapper`, `RichtextValue`, `createKeyGenerator`, …)      |

## `decap-cms-widget-lexicaleditor`

> **Developed in a separate repository** (moved out June 2026). Still published to npm under the
> same name. See [the restructure note](./restructure-2026-06.md).

Lexical-based rich text widget for Decap CMS, built on a shadcn-editor fork. Stores content as
Portable Text (via `decap-cms-lexical-core`) and renders a full-featured editor toolbar in the Decap
CMS control panel.

### Install

```bash
pnpm add decap-cms-widget-lexicaleditor decap-cms-lexical-core
```

### Main exports

| Export                      | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| `Widget`                    | Decap CMS widget definition object — pass to `CMS.registerWidget()`  |
| `LexicalControl`            | React control component (rendered in the Decap CMS editor panel)     |
| `LexicalPreview`            | React preview component (rendered in the Decap CMS preview panel)    |
| `lexicalEditorWidgetSchema` | Zod schema for the widget field configuration                        |
| `passthroughSerializer`     | Serializer that stores the Portable Text value as-is (no conversion) |
| `Editor`                    | The standalone Lexical editor React component (usable outside Decap) |

### Basic usage

```ts
import CMS from 'decap-cms-app';
import { Widget } from 'decap-cms-widget-lexicaleditor';

CMS.registerWidget(Widget);
```

Then in your Decap CMS config:

```yaml
collections:
  - name: posts
    fields:
      - name: body
        widget: lexicaleditor
```

## `decap-cms-widget-portabletext-editor`

> **Developed in a separate repository** (moved out June 2026). Still published to npm under the
> same name. See [the restructure note](./restructure-2026-06.md).

Decap CMS widget backed by `@portabletext/editor` (Sanity's native Portable Text editor). A sibling
of `decap-cms-widget-lexicaleditor` — choose this one when you want the official Portable Text
editing experience instead of Lexical.

### Install

```bash
pnpm add decap-cms-widget-portabletext-editor
```

### Main exports

| Export                      | Description                                                                |
| --------------------------- | -------------------------------------------------------------------------- |
| `Widget`                    | Decap CMS widget definition object — pass to `CMS.registerWidget()`        |
| `PortableTextEditorControl` | React control component (rendered in the Decap CMS editor panel)           |
| `PortableTextEditorPreview` | React preview component (rendered in the Decap CMS preview panel)          |
| `PortableTextEditorView`    | The standalone Portable Text editor React component (usable outside Decap) |
| `schema`                    | Default `@portabletext/editor` schema used by the widget                   |

### Basic usage

```ts
import CMS from 'decap-cms-app';
import { Widget } from 'decap-cms-widget-portabletext-editor';

CMS.registerWidget(Widget);
```

Then in your Decap CMS config:

```yaml
collections:
  - name: posts
    fields:
      - name: body
        widget: portabletext-editor
```

## `@laikacms/github`

GitHub-backed `StorageRepository` (GitHub App authentication).

| Subpath                       | Description                      |
| ----------------------------- | -------------------------------- |
| `@laikacms/github/storage-gh` | GitHub-backed storage repository |

### `GithubDataSourceOptions`

`GithubStorageRepository` accepts a `GithubDataSourceOptions` object. Notable option:

| Option    | Type                  | Description                                                                                                               |
| --------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `octokit` | `Octokit` (optional)  | Pre-configured Octokit instance. When provided, overrides the built-in GitHub App auth — useful for testing or fine-grained token auth. |

## `@laikacms/git-gateway`

Drop-in [Netlify git-gateway](https://github.com/netlify/git-gateway)-compatible HTTP handler. Lets
Decap CMS (configured with `backend: { name: git-gateway }`) talk to a fixed GitHub repo through a
GitHub App installation token, behind a pluggable Bearer-token verifier. Runtime-agnostic — runs on
Cloudflare Workers, Node, Bun, Deno, or anywhere Hono is supported.

| Subpath | Description                                   |
| ------- | --------------------------------------------- |
| `.`     | `gitGateway()` Hono app factory (root export) |

### `gitGateway(options)` options

| Option         | Type                                                               | Description                                                                              |
| -------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `verifyToken`  | `(token: string) => Promise<User \| null>`                         | Validates the incoming Bearer token. Return `null` (or throw) to reject.                 |
| `github`       | `{ appId, privateKey, installationId, owner, repo, apiBase? }`     | GitHub App credentials. `apiBase` defaults to `https://api.github.com` (useful for GHE). |
| `allowedRoles` | `string[]` (optional)                                              | When set, the user returned by `verifyToken` must have at least one matching role.       |
| `logger`       | `{ error, warn, info?, debug? }` (optional)                        | Pluggable structured logger (pino, bunyan, etc.). Only `error` and `warn` are required; `info` and `debug` are optional. Defaults to a no-op. |
| `userAgent`    | `string` (optional)                                                | Custom User-Agent for outgoing GitHub API requests. Defaults to `@laikacms/git-gateway`. |

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

## `laikacli`

The Laika CMS command-line interface for local development workflows. Provides a short `laika` bin
alias once installed; the canonical package name is `laikacli` (the `laika` npm name is taken by an
unrelated package).

> Supersedes the deprecated `@laikacms/local` package.

### Install

```sh
pnpm add -D laikacli
```

Or run without installing:

```sh
npx laikacli local serve
pnpm dlx laikacli local serve
```

### Commands

All local-file dev tooling lives under the `local` namespace.

| Command          | What it does                                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `local serve`    | Start a local-file JSON:API storage server for dev workflows (`--root`, `--port`, `--host`, `--default-extension` (default: `md`), `--auth-token`) |
| `local generate` | Generate a typed TypeScript module from a Decap CMS `config.yaml` (add `--watch` to keep it fresh)                                                 |
| `local migrate`  | Copy every atom from one storage repository to another (`-s ./source -d ./dest`)                                                                   |

Run `laika local <command> --help` for the full flag reference.

### Programmatic API

All CLI commands are also exported from the package root for embedding in your own scripts or Effect
CLI applications:

```ts
import { generateConfig, layerStorageServer, runMigrate } from 'laikacli';
```
