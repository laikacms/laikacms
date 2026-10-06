# Imports

Every import path, grouped by what it does. The **Install** column is the command that makes the
import available; everything else works the same whichever install it comes from.

Storage, documents, and assets backends are listed separately under [Adapters](../adapters/).

## Content

The interfaces every backend implements, and the JSON:API handlers that serve them over HTTP.

| Import                   | Install             | What it does                                                                                                                |
| ------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/storage`       | `pnpm add laikacms` | [`StorageRepository`](./api/laikacms/storage/classes/StorageRepository): objects, folders, and atoms                        |
| `laikacms/documents`     | `pnpm add laikacms` | [`DocumentsRepository`](./api/laikacms/documents/classes/DocumentsRepository): documents with drafts, publishing, revisions |
| `laikacms/assets`        | `pnpm add laikacms` | [`AssetsRepository`](./api/laikacms/assets/classes/AssetsRepository): media files with URLs and image variations            |
| `laikacms/catalog`       | `pnpm add laikacms` | [`CatalogProvider`](./api/laikacms/catalog/classes/CatalogProvider): collections and their JSON Schemas                     |
| `laikacms/storage/api`   | `pnpm add laikacms` | [`buildJsonApi`](./api/laikacms/storage/api/functions/buildJsonApi): a storage repository as a JSON:API handler             |
| `laikacms/documents/api` | `pnpm add laikacms` | A documents repository as a JSON:API handler                                                                                |
| `laikacms/assets/api`    | `pnpm add laikacms` | An assets repository as a JSON:API handler                                                                                  |
| `laikacms/catalog-api`   | `pnpm add laikacms` | Catalog settings as a JSON:API handler                                                                                      |
| `laikacms/json-api`      | `pnpm add laikacms` | Shared JSON:API helpers, including the explicit [`allowAll`](./api/laikacms/json-api/functions/allowAll) policy             |

## Catalogs

Where collection definitions come from.

| Import                        | Install                           | What it does                                                                                                                                       |
| ----------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/catalog-convention` | `pnpm add laikacms`               | Collections by convention: each collection is the folder with the same name. Defaults are created on first use, no seeding needed.                 |
| `laikacms/catalog-decap`      | `pnpm add laikacms`               | Collections derived from a Decap CMS config, so the server and the editor share one source of truth. Supports multi-folder and nested collections. |
| `@laikacms/aws/catalog-ddb`   | `pnpm add laikacms @laikacms/aws` | Catalog settings stored in DynamoDB                                                                                                                |

## Serializers

Any serializer works with any storage adapter. Register one per file extension.

| Import                          | Install             | What it does                     |
| ------------------------------- | ------------------- | -------------------------------- |
| `laikacms/serializers/json`     | `pnpm add laikacms` | JSON                             |
| `laikacms/serializers/yaml`     | `pnpm add laikacms` | YAML                             |
| `laikacms/serializers/markdown` | `pnpm add laikacms` | Markdown with frontmatter        |
| `laikacms/serializers/raw`      | `pnpm add laikacms` | Raw text or binary, stored as-is |

## Running tasks

| Import            | Install             | What it does                                                                                                                                                                                                                                            |
| ----------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/compat` | `pnpm add laikacms` | [`runTask`](./api/laikacms/compat/functions/runTask) and [`collectStream`](./api/laikacms/compat/functions/collectStream): run tasks and streams as Promises, without importing Effect. Pass `onProgress` to receive progress and recoverable warnings. |
| `laikacms/core`   | `pnpm add laikacms` | [`LaikaTask`](./api/laikacms/core/namespaces/LaikaTask/), [`LaikaStream`](./api/laikacms/core/namespaces/LaikaStream/), shared types, and errors, for code that uses Effect directly                                                                    |

## Errors

| Import                       | Install             | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/core/errors`       | `pnpm add laikacms` | Every [`LaikaError`](./api/laikacms/core/errors/classes/LaikaError) class. Commonly caught: [`NotFoundError`](./api/laikacms/core/errors/classes/NotFoundError), [`BadRequestError`](./api/laikacms/core/errors/classes/BadRequestError), [`ForbiddenError`](./api/laikacms/core/errors/classes/ForbiddenError), [`LockConflictError`](./api/laikacms/core/errors/classes/LockConflictError), [`VersionMismatchError`](./api/laikacms/core/errors/classes/VersionMismatchError), [`EntryAlreadyExistsError`](./api/laikacms/core/errors/classes/EntryAlreadyExistsError), [`TooManyRequestsError`](./api/laikacms/core/errors/classes/TooManyRequestsError) |
| `laikacms/core/errors-extra` | `pnpm add laikacms` | HTTP mapping for errors: [`ErrorCodeToStatusMap`](./api/laikacms/core/errors-extra/variables/ErrorCodeToStatusMap) (error code to HTTP status), [`ErrorCodeToKeyMap`](./api/laikacms/core/errors-extra/variables/ErrorCodeToKeyMap), [`ErrorClasses`](./api/laikacms/core/errors-extra/variables/ErrorClasses)                                                                                                                                                                                                                                                                                                                                              |

## Serving and authentication

| Import                         | Install                              | What it does                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/server/api`         | `pnpm add laikacms @laikacms/server` | [`laikaApi`](../guides/api-server): documents, storage, and assets behind one authenticated endpoint                                                                                                                                                                                                                                                                       |
| `@laikacms/server/oauth2`      | `pnpm add laikacms @laikacms/server` | A self-contained OAuth2 login server: PKCE, email and password, passkeys, TOTP two-factor                                                                                                                                                                                                                                                                                  |
| `@laikacms/server/oauth2/i18n` | `pnpm add laikacms @laikacms/server` | Translations for the login pages (`…/en`, `…/nl`)                                                                                                                                                                                                                                                                                                                          |
| `laikacms/auth`                | `pnpm add laikacms`                  | Scopes ([`hasScope`](./api/laikacms/auth/functions/hasScope), [`requireScope`](./api/laikacms/auth/functions/requireScope), …), personal access tokens ([`mintPersonalAccessToken`](./api/laikacms/auth/functions/mintPersonalAccessToken), [`hashToken`](./api/laikacms/auth/functions/hashToken), …), and [`resolveBearer`](./api/laikacms/auth/functions/resolveBearer) |
| `laikacms/locks/in-process`    | `pnpm add laikacms`                  | [`InProcessLockManager`](./api/laikacms/locks/in-process/classes/InProcessLockManager): advisory document locks for a single server process                                                                                                                                                                                                                                |

See [Authentication](../guides/decap/auth) for how these fit together.

## Uploads

| Import                    | Install             | What it does                                                                                                                                                                                                                                            |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/file-sanitizer` | `pnpm add laikacms` | Strips privacy-sensitive metadata from PNG, GIF, WebP, and JPEG uploads, and scans for dangerous content ([`sanitizeFile`](./api/laikacms/file-sanitizer/functions/sanitizeFile), [`canSanitize`](./api/laikacms/file-sanitizer/functions/canSanitize)) |
| `laikacms/sanitizer`      | `pnpm add laikacms` | The [`Sanitizer`](./api/laikacms/sanitizer/interfaces/Sanitizer) interface assets repositories accept, for plugging in your own sanitizer                                                                                                               |

## Integrations

| Import                    | Install                                   | What it does                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/astro`         | `pnpm add laikacms @laikacms/astro`       | [Astro](../guides/astro) integration: dev JSON:API, content hot reload, types                                                                                                                                                      |
| `@laikacms/astro/loader`  | `pnpm add laikacms @laikacms/astro`       | Content Layer loaders: [`documentsLoader()`](./api/astro/loader/functions/documentsLoader), [`objectsLoader()`](./api/astro/loader/functions/objectsLoader), [`laikaCollections()`](./api/astro/loader/functions/laikaCollections) |
| `@laikacms/astro/live`    | `pnpm add laikacms @laikacms/astro`       | [`liveDocumentsLoader()`](./api/astro/live/functions/liveDocumentsLoader) for live collections and draft previews                                                                                                                  |
| `@laikacms/astro/api`     | `pnpm add laikacms @laikacms/astro`       | [`createApiHandler`](./api/astro/api/functions/createApiHandler): serve the API from an Astro route                                                                                                                                |
| `@laikacms/astro/testing` | `pnpm add laikacms @laikacms/astro`       | A fake `LoaderContext` for testing loaders without booting Astro                                                                                                                                                                   |
| `@laikacms/vite-plugin`   | `pnpm add laikacms @laikacms/vite-plugin` | [Vite](../guides/vite) plugin: import content as ES modules at build time                                                                                                                                                          |

## Decap CMS

| Import                               | Install                                                                | What it does                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@laikacms/decap-cms`                | `pnpm add '@laikacms/decap-cms@^4.1.0' @emotion/react @emotion/styled` | The Laika-enabled Decap CMS editor ([details](../guides/decap/fork))                                                                                        |
| `@laikacms/decap-cms/backends/laika` | same as above                                                          | `createLaikaBackend()`: connects the editor to your Laika API                                                                                               |
| `@laikacms/decap-cms/widgets/*`      | same as above                                                          | Extra [widgets](../guides/decap/widgets-and-editors): AI chat, icon pickers                                                                                 |
| `@laikacms/server/ai`                | `pnpm add laikacms @laikacms/server ai`                                | Server side of the editor's [AI assistant](../guides/ai-assistant)                                                                                          |
| `@laikacms/server/embedded`          | `pnpm add laikacms @laikacms/server`                                   | [`createEmbeddedLaika()`](./api/server/embedded/functions/createEmbeddedLaika): a complete filesystem-backed backend from one options object (Node.js only) |
| `@laikacms/git-gateway`              | `pnpm add @laikacms/git-gateway hono`                                  | A [Netlify git-gateway](../guides/decap/git-gateway) replacement                                                                                            |

## Writing your own adapter

| Import                       | Install             | What it does                                                                                                                                                                             |
| ---------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/storage/testing`   | `pnpm add laikacms` | Contract tests for `StorageRepository` implementations                                                                                                                                   |
| `laikacms/documents/testing` | `pnpm add laikacms` | Contract tests for `DocumentsRepository`, plus [`InMemoryDocumentsRepository`](./api/laikacms/documents/testing/classes/InMemoryDocumentsRepository), a fast in-memory backend for tests |
| `laikacms/assets/testing`    | `pnpm add laikacms` | Contract tests for `AssetsRepository` implementations                                                                                                                                    |

## Utilities

| Import                    | Install             | What it does                                                                                                                                                                                                                                      |
| ------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `laikacms/core/utilities` | `pnpm add laikacms` | Dependency-free helpers (`memoize`, `lazy`, [`Url`](./api/laikacms/core/utilities/variables/Url), [`Header`](./api/laikacms/core/utilities/variables/Header), [`Paths`](./api/laikacms/core/utilities/variables/Paths)) that don't pull in Effect |
| `laikacms/core/types/*`   | `pnpm add laikacms` | Individual type modules: `datetime`, `mime-type`, `pagination`, `role`, …                                                                                                                                                                         |
| `laikacms/crypto`         | `pnpm add laikacms` | Hashing, password hashing, constant-time comparison, randomness. Import `laikacms/crypto/<module>` to pull in one part only                                                                                                                       |
| `laikacms/i18n`           | `pnpm add laikacms` | Shared UI strings: OK, Cancel, Save, … (`…/en`, `…/nl`)                                                                                                                                                                                           |

Older dashed import names (`laikacms/storage-fs`, `laikacms/storage-serializers-json`, …) are
aliases of the paths above and resolve to the same modules.
