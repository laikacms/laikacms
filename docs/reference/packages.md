# Packages

Most functionality lives in `laikacms` as subpath exports; specialized integrations live in their
own packages.

This page is the hand-authored package map. Package-specific reference/usage docs are co-located
with the code under `packages/<pkg>/docs/` and aggregated into the site under **Reference >
Packages** — see [Package reference docs](../contributing/package-docs) for the convention. Two
packages currently have co-located docs: [`laikacms`](./packages/laikacms/) and
[`@laikacms/server`](./packages/server/).

> **Repository layout (June 2026, updated July 2026, updated August 2026).** This monorepo carries
> `laikacms`, `@laikacms/server`, `@laikacms/vite-plugin`, `@laikacms/github`, `@laikacms/gitlab`,
> and `@laikacms/bitbucket` as actively developed packages (`@laikacms/decap-ai` and the client-side
> decap extras moved into the `@laikacms/decap-cms` fork in July 2026, DCMS-492). The other packages
> documented below (`@laikacms/aws`, `@laikacms/git-gateway`, `laikacli`,
> `decap-cms-widget-lexicaleditor`, `decap-cms-widget-portabletext-editor`,
> `decap-cms-lexical-core`, and the rest of the adapters) are still published to npm under the same
> names but are now developed in **separate repositories**. Their npm names are unchanged, so
> consumers install them exactly as before.

## `laikacms`

The core package: domain types, API factories, default implementations, serializers, and shared
utilities. Imported via subpath exports.

### Domain (`packages/laikacms/src/domain/`)

| Subpath              | Description                                    |
| -------------------- | ---------------------------------------------- |
| `laikacms/storage`   | Storage abstractions (objects, folders, atoms) |
| `laikacms/documents` | Document management with revisions             |
| `laikacms/assets`    | Asset/media management                         |
| `laikacms/catalog`   | Catalog configuration                          |

### API (`packages/laikacms/src/api/`)

| Subpath                  | Description            |
| ------------------------ | ---------------------- |
| `laikacms/storage/api`   | JSON:API for storage   |
| `laikacms/documents/api` | JSON:API for documents |
| `laikacms/assets/api`    | JSON:API for assets    |
| `laikacms/catalog-api`   | JSON:API for Catalog   |

### Implementations (`packages/laikacms/src/impl/`)

| Subpath                            | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/storage/r2`              | [Cloudflare R2 storage](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/storage-r2/README.md)                                                                                                                                                                                                                                                                                                                                            |
| `laikacms/storage/fs`              | [Filesystem storage](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/storage-fs/README.md)                                                                                                                                                                                                                                                                                                                                               |
| `laikacms/storage/s3`              | S3→R2Bucket adapter (`createS3Bucket()`) — pairs with `R2StorageRepository`, not a `StorageRepository` itself. See `@laikacms/aws/storage-s3` for the full S3 `StorageRepository`.                                                                                                                                                                                                                                                                                    |
| `laikacms/storage/web`             | Web `Storage` (`localStorage`/`sessionStorage`) — client-side, read+write, SSR-safe                                                                                                                                                                                                                                                                                                                                                                                   |
| `laikacms/storage/web-fs`          | Browser File System API — any directory handle (origin-private or user-picked), real hierarchy (no `.keep` markers), read+write, permission-aware, SSR-safe                                                                                                                                                                                                                                                                                                           |
| `laikacms/storage/webdav`          | WebDAV server                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `laikacms/storage/github-cdn`      | Read-only storage backed by a public GitHub repo, served via jsDelivr's CDN (no token, no `@octokit/*`, no `api.github.com` round-trip)                                                                                                                                                                                                                                                                                                                               |
| `laikacms/storage/drizzle`         | Drizzle ORM storage                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `laikacms/storage/jsonapi-proxy`   | Storage JSON:API proxy                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `laikacms/assets/r2`               | R2 asset storage                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `laikacms/assets/catalog`          | Assets on top of storage                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `laikacms/assets/obsidian`         | Obsidian-vault-backed assets                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `laikacms/assets/jsonapi-proxy`    | Assets JSON:API proxy                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `laikacms/documents/catalog`       | Documents on top of storage                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `laikacms/documents/drizzle`       | Drizzle document storage                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `laikacms/documents/obsidian`      | Obsidian-vault-backed documents                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `laikacms/documents/jsonapi-proxy` | Documents JSON:API proxy                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `laikacms/locks/in-process`        | [In-process advisory document locking](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/locks-in-process/README.md) (ADR-007) — `InProcessLockManager`, single-node only (`scope: 'in-process'`)                                                                                                                                                                                                                                          |
| `laikacms/catalog-convention`      | [Convention-based catalog settings](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/catalog-convention/README.md) — maps collection names to same-name folders by convention; auto-creates defaults on first use — no seeding required. Persists to `.laika/catalog` and `.laika/schemas/<collection>` in storage (extensionless, so your serializers pick the format). Use for simple setups where folder names match collection names. |
| `laikacms/catalog-decap`           | [Decap-config-derived catalog settings](https://github.com/laikacms/laikacms/blob/develop/packages/laikacms/src/impl/catalog-decap/README.md) — derives collection/folder/media mappings from a Decap config JSON seeded into storage (the `configKey` option). Use when the server and browser Decap configs must stay in sync from one source of truth, or when you need multi-folder or nested collection support.                                                 |

### Testing utilities (`packages/laikacms/src/`)

| Subpath                      | Description                                                                                                                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/documents/testing` | Contract test harness + `InMemoryDocumentsRepository` reference implementation for `DocumentsRepository` — use as a fast in-memory backend in integration tests or as a contract-compliance reference |
| `laikacms/storage/testing`   | Contract test harness for `StorageRepository` implementations                                                                                                                                         |
| `laikacms/assets/testing`    | Contract test harness for `AssetsRepository` implementations                                                                                                                                          |

### Serializers (`packages/laikacms/src/serializers/`)

| Subpath                         | Description               |
| ------------------------------- | ------------------------- |
| `laikacms/serializers/json`     | JSON serialization        |
| `laikacms/serializers/yaml`     | YAML serialization        |
| `laikacms/serializers/markdown` | Markdown with frontmatter |
| `laikacms/serializers/raw`      | Raw binary/text           |

`StorageSerializer` implementations (`StorageFormat`-typed, for wiring into a `StorageRepository`)
are exported as separate `storage-serializers-*` subpaths rather than under `serializers/*`:

| Subpath                                 | Description                                       |
| --------------------------------------- | ------------------------------------------------- |
| `laikacms/storage-serializers-json`     | `StorageSerializer` for JSON documents            |
| `laikacms/storage-serializers-yaml`     | `StorageSerializer` for YAML documents            |
| `laikacms/storage-serializers-markdown` | `StorageSerializer` for Markdown with frontmatter |
| `laikacms/storage-serializers-raw`      | `StorageSerializer` for raw binary/text           |

### Shared (`packages/laikacms/src/shared/`)

| Subpath                      | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/auth`              | Scope vocabulary (`hasScope`, `isScope`, `normalizeScopes`, `ADMIN_SCOPE`, `WILDCARD_SCOPE`, `GRANULAR_SCOPES`, `ALL_SCOPES`), PAT utils (`generateToken`, `hashToken`, `hashesEqual`, `isPatToken`, `tokenPreview`, `mintPersonalAccessToken`), bearer unification (`resolveBearer`), and scope enforcement (`requireScope`, `hasRequiredScope`, `InsufficientScopeError`)                                                                                                 |
| `laikacms/compat`            | Promise-bridge helpers (`runTask`, `collectStream`) for consuming `LaikaTask`/`LaikaStream` without importing `effect` directly. Both accept an optional `CompatOptions` second argument: `{ onProgress?: (meta: LaikaMetadata) => void }` fires for each progress tick and recoverable error while the task/stream runs — the only way to observe recoverable errors in Promise-based callers. Example: `await runTask(myTask, { onProgress: meta => console.log(meta) })` |
| `laikacms/core`              | Types, errors, utilities                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `laikacms/core/errors`       | Domain error classes (`LaikaError` subclasses: `NotFoundError`, `BadRequestError`, `InternalError`, etc.)                                                                                                                                                                                                                                                                                                                                                                   |
| `laikacms/core/errors-extra` | HTTP adapter utilities: `ErrorCodeToStatusMap` (error code → HTTP status), `ErrorCodeToKeyMap`, `ErrorClasses`                                                                                                                                                                                                                                                                                                                                                              |
| `laikacms/core/types/*`      | Targeted type modules — `datetime`, `effect`, `ext-name`, `mime-type`, `pagination`, `role`, `role-permission`                                                                                                                                                                                                                                                                                                                                                              |
| `laikacms/core/utilities`    | Dependency-free helpers (`memoize`, `lazy`, `lazyAsync`, `Url`, `Header`, `Paths`, `TemplateLiteral`) — safe for bundled consumers that must not pull in Effect or the laika domain graph                                                                                                                                                                                                                                                                                   |
| `laikacms/crypto`            | Cryptographic utilities (barrel — imports all modules)                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `laikacms/crypto/*`          | Per-module granular access: `laikacms/crypto/constant-time`, `laikacms/crypto/hash`, `laikacms/crypto/password`, `laikacms/crypto/random`, `laikacms/crypto/timing` — avoids dragging unused crypto deps (e.g. `bcryptjs`) when only one module is needed                                                                                                                                                                                                                   |
| `laikacms/file-sanitizer`    | File upload sanitization                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `laikacms/i18n`              | Internationalization (bundle index)                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `laikacms/i18n/en`           | English translations                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `laikacms/i18n/nl`           | Dutch translations                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `laikacms/json-api`          | JSON:API utilities                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `laikacms/sanitizer`         | Input sanitization                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

## `@laikacms/aws`

AWS service implementations.

| Subpath                     | Description                                                                            |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `@laikacms/aws/catalog-ddb` | DynamoDB-backed catalog settings                                                       |
| `@laikacms/aws/storage-s3`  | S3-backed StorageRepository (also works with MinIO, Backblaze B2, DigitalOcean Spaces) |
| `@laikacms/aws/storage-ddb` | DynamoDB single-table StorageRepository                                                |
| `@laikacms/aws/assets-s3`   | S3-backed AssetsRepository                                                             |

## `@laikacms/server`

Decap CMS server-side integrations: the Decap-compatible API, the OAuth2 server, and the AI
chat/session endpoints.

> **Moved (July 2026, DCMS-492):** The icon widgets, the Dutch locale, the embedded-entry editor
> component, and the config type utilities moved into the `@laikacms/decap-cms` fork:
> `…/widgets/lucide-icon`, `…/widgets/radix-icon`, `…/locales/nl`,
> `…/editor-component-embedded-entry`, and `…/config-types`.
>
> **Moved back (August 2026):** The AI chat/session server (`@laikacms/server/ai`) returned to this
> package after a brief stint in the fork. Do **not** look for it in `@laikacms/decap-cms`.

| Subpath                              | Description                                                                                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/decap-cms/backends/laika` | Decap CMS backend (`createLaikaBackend()`)                                                                                                         |
| `@laikacms/server/api`               | [JSON:API router](https://github.com/laikacms/laikacms/blob/develop/packages/server/src/api/README.md)                                             |
| `@laikacms/server/embedded`          | Node.js-only `createEmbeddedLaika()` — wires a full backend from one options object                                                                |
| `@laikacms/server/oauth2`            | OAuth2 server with PKCE                                                                                                                            |
| `@laikacms/server/oauth2/i18n`       | i18n bundle index for the OAuth2 UI                                                                                                                |
| `@laikacms/server/oauth2/i18n/en`    | English translations for the OAuth2 UI                                                                                                             |
| `@laikacms/server/oauth2/i18n/nl`    | Dutch translations for the OAuth2 UI                                                                                                               |
| `@laikacms/server/ai`                | AI chat + session endpoints (optional `ai` peer; see [README](https://github.com/laikacms/laikacms/blob/develop/packages/server/src/ai/README.md)) |
| `@laikacms/server/ai/providers`      | Re-exported Vercel AI SDK provider factories                                                                                                       |
| `@laikacms/server/ai/tools`          | Built-in document tools (`getDocumentData`, `updateDocument`) for the client-side tool loop                                                        |
| `@laikacms/server/ai/i18n/en`        | English translations for the AI UI                                                                                                                 |
| `@laikacms/server/ai/i18n/nl`        | Dutch translations for the AI UI                                                                                                                   |
| `@laikacms/server/ai/i18n/types`     | `Translation` interface for custom i18n                                                                                                            |

## `@laikacms/decap-cms`

The scoped single-package fork of Decap CMS v4. It is a **required peer dependency of
`@laikacms/server`** — the admin bundle esbuild step resolves its subpaths at build time, so without
it the build fails with unresolved `@laikacms/decap-cms/…` errors.

See [The `@laikacms/decap-cms` fork](../guides/decap/fork) for the full package reference.

### Install

```sh
pnpm add '@laikacms/decap-cms@^4.1.0' @emotion/react @emotion/styled
```

The `^4.1.0` floor keeps the solver off `4.0.2`, which was published with unresolved `catalog:`
specs and is not deprecated — installing it fails with
`ERR_PNPM_SPEC_NOT_SUPPORTED_BY_ANY_RESOLVER`. Releases from `4.0.3` up are clean. See
[laikacms/decap-cms#941](https://github.com/laikacms/decap-cms/issues/941).

`@emotion/react` and `@emotion/styled` are required (non-optional) peer dependencies — the admin
shell is styled with Emotion. `@laikacms/decap-cms` also declares optional peers for specific
widgets (`@apollo/client`, `graphql`, `ol`, `uploadcare-widget`, `lucide-react`,
`@radix-ui/react-icons`, …); install only the ones the widgets you use require.

### Key subpaths

| Subpath                            | Used by                                                 |
| ---------------------------------- | ------------------------------------------------------- |
| `@laikacms/decap-cms/core`         | Core CMS bootstrap                                      |
| `@laikacms/decap-cms/lib/util`     | Internal utilities consumed by the Laika backend        |
| `@laikacms/decap-cms/lib/auth`     | Auth primitives consumed by the Laika backend           |
| `@laikacms/decap-cms/ui-default`   | Default editor UI (bundled into `admin/bundle.js`)      |
| `@laikacms/decap-cms/laika-app`    | Full Laika-wired admin app (alternative to root export) |
| `@laikacms/decap-cms/config-types` | TypeScript types for `config.yml` / `config.json`       |
| `@laikacms/decap-cms/locales/*`    | Locale bundles (e.g. `./locales/nl`, `./locales/en`)    |
| `@laikacms/decap-cms/widgets/*`    | Extra widgets (aichat, lucide-icon, radix-icon, …)      |

## `@laikacms/vite-plugin`

A Vite / [Rolldown](https://rolldown.rs) plugin that loads Laika CMS content as ES modules at build
time via the `laika:` protocol (e.g. `import { title } from 'laika:doc/posts/hello'`), tree-shaken
per field and type-generated from the real content data. It also has an opt-in dev-server-only
"local mode" that mounts a real JSON:API (storage, documents, and optionally assets) for tools that
need one, such as the Decap admin. See
[`packages/vite-plugin/README.md`](https://github.com/laikacms/laikacms/blob/develop/packages/vite-plugin/README.md)
for the full reference (the `laika:` protocol, `import.meta.glob` support, MDX bodies, hot reload,
and all plugin options).

### Install

```sh
npm install -D @laikacms/vite-plugin laikacms
```

Requires Vite `>=8` (Rolldown-based).

### Basic usage

```ts
// vite.config.ts
import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [laikacms({ dir: 'content' })],
});
```

### Main exports

| Export                 | Description                                                                             |
| ---------------------- | --------------------------------------------------------------------------------------- |
| `laikacms()`           | The Vite plugin factory — the default export consumers use in `vite.config.ts`          |
| `mountLocalApi()`      | Mounts local mode's JSON:API onto any dev server, independent of the `localApi` option  |
| `LaikaLocalApiOptions` | Type for `mountLocalApi()`'s options                                                    |
| `createRepositories()` | Helper to build the storage/documents repository pair when supplying your own `storage` |

## `decap-cms-lexical-core`

> **Developed in a separate repository** (moved out June 2026). Still published to npm under the
> same name.

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
> same name.

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
| `lexicalEditorWidgetSchema` | Zod schema for the widget field configuration (outdated?)            |
| `passthroughSerializer`     | Serializer that stores the Portable Text value as-is (no conversion) |
| `Editor`                    | The standalone Lexical editor React component (usable outside Decap) |

### Basic usage

```ts
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
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
> same name.

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
import { DecapCmsApp as CMS } from '@laikacms/decap-cms';
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

`GithubStorageRepository` accepts a `GithubDataSourceOptions` object. Auth is a discriminated union
— supply either a pre-built `octokit` instance **or** the three GitHub App credential fields:

| Option            | Type                | Required when           | Description                                                                                      |
| ----------------- | ------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| `octokit`         | `Octokit`           | using PAT / custom auth | Pre-configured Octokit instance. When provided, App credentials (`appId` etc.) are not required. |
| `appId`           | `string \| number`  | App auth (no `octokit`) | GitHub App ID.                                                                                   |
| `privateKey`      | `string`            | App auth (no `octokit`) | GitHub App private key (PEM). Literal `\n` sequences and surrounding quotes are normalised.      |
| `installationId`  | `string \| number`  | App auth (no `octokit`) | GitHub App installation ID for the target repository.                                            |
| `owner`           | `string`            | always                  | GitHub repository owner (user or org).                                                           |
| `repo`            | `string`            | always                  | GitHub repository name.                                                                          |
| `branch`          | `string`            | always                  | Branch to read from and commit to.                                                               |
| `tokenTtlSeconds` | `number` (optional) | —                       | Installation token TTL in seconds. Defaults to 50 minutes (tokens last ~1 h).                    |
| `userAgent`       | `string` (optional) | —                       | Custom User-Agent header for GitHub API requests. Defaults to `@laikacms/github`.                |

## `@laikacms/gitlab`

GitLab-backed `StorageRepository` via the REST v4 API. Authenticates with a Personal Access Token,
an OAuth bearer token, or a CI job token. Runtime-agnostic — only depends on `fetch`.

| Subpath                       | Description                      |
| ----------------------------- | -------------------------------- |
| `@laikacms/gitlab/storage-gl` | GitLab-backed storage repository |

### `GitlabStorageRepositoryOptions`

| Option                 | Type                                         | Required | Description                                                                                        |
| ---------------------- | -------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `projectId`            | `string \| number`                           | always   | Numeric project ID or URL-encoded path (`group/subgroup/project`).                                 |
| `branch`               | `string`                                     | always   | Branch to read from and commit to.                                                                 |
| `auth`                 | `GitlabAuth`                                 | —        | Auth credentials. Omit for anonymous reads on public projects. See auth union below.               |
| `apiUrl`               | `string` (optional)                          | —        | API base URL. Defaults to `https://gitlab.com/api/v4`. Override for self-hosted GitLab.            |
| `serializerRegistry`   | `StorageSerializerRegistry`                  | always   | Map of extension → serializer (e.g. `{ md: markdownSerializer }`).                                 |
| `defaultFileExtension` | `string`                                     | always   | Extension used when creating objects (e.g. `'md'`).                                                |
| `commitAuthor`         | `{ name: string, email: string }` (optional) | —        | Author attached to every commit. Omit to use the token owner's identity.                           |
| `ignoreList`           | `readonly string[]` (optional)               | —        | Glob patterns to exclude from directory listings. Defaults hide `.keep`, `.DS_Store`, etc.         |
| `determineExtension`   | `DetermineExtension` (optional)              | —        | Custom strategy for picking the on-server file extension. Defaults to `defaultDetermineExtension`. |

**`GitlabAuth` union** — supply exactly one of:

| Field        | Type                                | Description                                                |
| ------------ | ----------------------------------- | ---------------------------------------------------------- |
| `token`      | `string`                            | Personal access token. Sent as `PRIVATE-TOKEN` header.     |
| `oauthToken` | `string`                            | OAuth 2.0 bearer token. Sent as `Authorization: Bearer …`. |
| `jobToken`   | `string`                            | CI job token. Sent as `JOB-TOKEN` header.                  |
| `headers`    | `Record<string, string>` (optional) | Extra headers merged into every request.                   |

## `@laikacms/bitbucket`

Bitbucket Cloud-backed `StorageRepository` via the REST v2 API. Authenticates with an app password
or an OAuth 2.0 token. Runtime-agnostic — only depends on `fetch`.

| Subpath                          | Description                         |
| -------------------------------- | ----------------------------------- |
| `@laikacms/bitbucket/storage-bb` | Bitbucket-backed storage repository |

### `BitbucketStorageRepositoryOptions`

| Option                 | Type                                         | Required | Description                                                                                |
| ---------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `workspace`            | `string`                                     | always   | Bitbucket workspace slug (e.g. `'acme'`).                                                  |
| `repo`                 | `string`                                     | always   | Repository slug within the workspace.                                                      |
| `branch`               | `string`                                     | always   | Branch every commit lands on.                                                              |
| `auth`                 | `BitbucketAuth`                              | always   | Auth credentials. See auth union below.                                                    |
| `apiUrl`               | `string` (optional)                          | —        | API base URL. Defaults to `https://api.bitbucket.org/2.0`.                                 |
| `serializerRegistry`   | `StorageSerializerRegistry`                  | always   | Map of extension → serializer (e.g. `{ md: markdownSerializer }`).                         |
| `defaultFileExtension` | `string`                                     | always   | Extension used when creating objects (e.g. `'md'`).                                        |
| `commitAuthor`         | `{ name: string, email: string }` (optional) | —        | Author attached to every commit.                                                           |
| `ignoreList`           | `readonly string[]` (optional)               | —        | Glob patterns to exclude from directory listings. Defaults hide `.keep`, `.DS_Store`, etc. |
| `determineExtension`   | `DetermineExtension` (optional)              | —        | Custom strategy for picking the on-server file extension.                                  |

**`BitbucketAuth` union** — supply one of:

| Field           | Type                                     | Description                                                                    |
| --------------- | ---------------------------------------- | ------------------------------------------------------------------------------ |
| `appPassword`   | `{ username: string, password: string }` | App-password tuple. Sent as HTTP Basic.                                        |
| `oauthToken`    | `string`                                 | OAuth 2.0 access token. Sent as Bearer.                                        |
| `tokenProvider` | `() => string \| Promise<string>`        | Async token provider — called before every request (useful for token refresh). |
| `headers`       | `Record<string, string>` (optional)      | Extra headers merged into every request.                                       |

## `@laikacms/git-gateway`

Drop-in [Netlify git-gateway](https://github.com/netlify/git-gateway)-compatible HTTP handler. Lets
Decap CMS (configured with `backend: { name: git-gateway }`) talk to a fixed GitHub repo through a
GitHub App installation token, behind a pluggable Bearer-token verifier. Runtime-agnostic — runs on
Cloudflare Workers, Node, Bun, Deno, or anywhere Hono is supported.

| Subpath | Description                                   |
| ------- | --------------------------------------------- |
| `.`     | `gitGateway()` Hono app factory (root export) |

### `gitGateway(options)` options

| Option         | Type                                                           | Description                                                                                                                                   |
| -------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `verifyToken`  | `(token: string) => Promise<User \| null>`                     | Validates the incoming Bearer token. Return `null` (or throw) to reject.                                                                      |
| `github`       | `{ appId, privateKey, installationId, owner, repo, apiBase? }` | GitHub App credentials. `apiBase` defaults to `https://api.github.com` (useful for GHE).                                                      |
| `allowedRoles` | `string[]` (optional)                                          | When set, the user returned by `verifyToken` must have at least one matching role.                                                            |
| `logger`       | `{ error, warn, info?, debug? }` (optional)                    | Pluggable structured logger (pino, bunyan, etc.). Only `error` and `warn` are required; `info` and `debug` are optional. Defaults to a no-op. |
| `userAgent`    | `string` (optional)                                            | Custom User-Agent for outgoing GitHub API requests. Defaults to `@laikacms/git-gateway`.                                                      |

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

The Laika CMS command-line interface for scaffolding new projects and local development workflows.
Provides a short `laika` bin alias once installed; the canonical package name is `laikacli` (the
`laika` npm name is taken by an unrelated package).

> Supersedes the deprecated `@laikacms/local` package.

### Install

```sh
pnpm add -D laikacli
```

Or run without installing:

```sh
npx laikacli create
pnpm dlx laikacli local serve
```

### Commands

| Command               | What it does                                                                                                                                                                                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`              | Wizard that bootstraps a starter app and generates its `src/cms.ts` from your backend/widget/locale selection (`--starter`, `--name`, `--directory`, `--package-manager`, `--backends`, `--widgets`, `--locales`, `--yes`, `--skip-install`)                                                                                                       |
| `local serve`         | Start a local-file JSON:API storage server for dev workflows (`--root`, `--port`, `--host`, `--default-extension` (default: `md`), `--auth-token`)                                                                                                                                                                                                 |
| `local generate`      | Generate a typed TypeScript module from the CMS config file (`--input/-i`, `--output/-o`, `--watch/-w`, `--cms`)                                                                                                                                                                                                                                   |
| `local migrate`       | Copy every atom between any two backends. Use `--source-backend`/`--destination-backend` for cross-backend migration (e.g. FS → R2, FS → SurrealDB); `-s`/`-d` are FS shortcuts for the common FS-to-FS case. Additional flags: `--dry-run` (preview without writing), `--overwrite`, `--concurrency` (default: 4), `--page-size` (default: 1000). |
| `local list-backends` | List every registered storage backend and its pinned package version.                                                                                                                                                                                                                                                                              |

Run `laika <command> --help` for the full flag reference.

### Programmatic API

All CLI commands are also exported from the package root for embedding in your own scripts or Effect
CLI applications:

```ts
import { bootstrapApplication, generateConfig, layerStorageServer, runMigrate } from 'laikacli';
```
