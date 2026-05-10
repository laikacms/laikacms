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
