# Packages

## Domain (`packages/domain/`)

| Package                          | Description                                    |
| -------------------------------- | ---------------------------------------------- |
| `@laikacms/storage`              | Storage abstractions (objects, folders, atoms) |
| `@laikacms/documents`            | Document management with revisions             |
| `@laikacms/assets`               | Asset/media management                         |
| `@laikacms/contentbase-settings` | ContentBase configuration                      |

## API (`packages/api/`)

| Package                     | Description              |
| --------------------------- | ------------------------ |
| `@laikacms/storage-api`     | JSON:API for storage     |
| `@laikacms/documents-api`   | JSON:API for documents   |
| `@laikacms/assets-api`      | JSON:API for assets      |
| `@laikacms/contentbase-api` | JSON:API for ContentBase |

## Implementation (`packages/impl/`)

| Package                           | Description              |
| --------------------------------- | ------------------------ |
| `@laikacms/storage-r2`            | Cloudflare R2 storage    |
| `@laikacms/storage-fs`            | Filesystem storage       |
| `@laikacms/storage-drizzle`       | Drizzle ORM storage      |
| `@laikacms/assets-r2`             | R2 asset storage         |
| `@laikacms/documents-drizzle`     | Drizzle document storage |
| `@laikacms/documents-contentbase` | ContentBase documents    |

## Shared (`packages/shared/`)

| Package                    | Description              |
| -------------------------- | ------------------------ |
| `@laikacms/core`           | Types, errors, utilities |
| `@laikacms/crypto`         | Cryptographic utilities  |
| `@laikacms/file-sanitizer` | File upload sanitization |
| `@laikacms/i18n`           | Internationalization     |
| `@laikacms/json-api`       | JSON:API utilities       |
| `@laikacms/sanitizer`      | Input sanitization       |

## Serializers (`packages/serializers/`)

| Package                                  | Description               |
| ---------------------------------------- | ------------------------- |
| `@laikacms/storage-serializers-json`     | JSON serialization        |
| `@laikacms/storage-serializers-yaml`     | YAML serialization        |
| `@laikacms/storage-serializers-markdown` | Markdown with frontmatter |
| `@laikacms/storage-serializers-raw`      | Raw binary/text           |

## Decap CMS (`packages/decap/`)

| Package                                  | Description             |
| ---------------------------------------- | ----------------------- |
| `@laikacms/decap-cms-backend-laika`      | Decap CMS backend       |
| `@laikacms/decap-api`                    | Decap-compatible API    |
| `@laikacms/decap-oauth2`                 | OAuth2 server with PKCE |
| `@laikacms/decap-server-ai`              | AI integration server   |
| `@laikacms/decap-cms-widget-ai-chat`     | AI chat widget          |
| `@laikacms/decap-cms-widget-lucide-icon` | Lucide icon picker      |
| `@laikacms/decap-cms-widget-radix-icon`  | Radix icon picker       |
| `@laikacms/decap-cms-locale-nl`          | Dutch locale            |
