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

| Subpath                                  | Description                          |
| ---------------------------------------- | ------------------------------------ |
| `@laikacms/aws/contentbase-settings-ddb` | DynamoDB-backed contentbase settings |

## `@laikacms/decap-integrations`

Decap CMS integrations: backend, OAuth2, widgets, server adapters. AI chat lives in the separate
`@laikacms/decap-ai` package.

| Subpath                                                                  | Description                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `@laikacms/decap-integrations/decap-cms-backend-laika`                   | Decap CMS backend                                                     |
| `@laikacms/decap-integrations/decap-api`                                 | Decap-compatible API                                                  |
| `@laikacms/decap-integrations/decap-oauth2`                              | OAuth2 server with PKCE                                               |
| `@laikacms/decap-integrations/decap-cms-widget-lucide-icon`              | Lucide icon picker                                                    |
| `@laikacms/decap-integrations/decap-cms-widget-radix-icon`               | Radix icon picker                                                     |
| `@laikacms/decap-integrations/decap-cms-locale-nl`                       | Dutch locale                                                          |
| `@laikacms/decap-integrations/decap-cms-editor-component-embedded-entry` | Embedded entry editor component                                       |
| `@laikacms/decap-integrations/embedded`                                  | One-call setup for embedding Laika+Decap in Node.js apps (FS-backed)  |
| `@laikacms/decap-integrations/workers`                                   | One-call setup for Cloudflare Workers (R2-backed, no Node.js imports) |
| `@laikacms/decap-integrations/custom`                                    | Storage-agnostic preset — bring your own `StorageRepository`          |
| `@laikacms/decap-integrations/decap-config-types`                        | TypeScript type utilities derived from a Decap CMS config object      |

## `@laikacms/github`

GitHub-backed `StorageRepository` (GitHub App authentication).

| Subpath                       | Description                      |
| ----------------------------- | -------------------------------- |
| `@laikacms/github/storage-gh` | GitHub-backed storage repository |
