# laikacms/catalog-api

JSON:API server for content-base collection settings (document and media collections).

## ⚠️ Access control

`buildJsonApi` **requires** an `authorize` policy — there is no implicit default, because an API
that silently defaults to open is the failure mode this option exists to prevent. The callback runs
before every action, including the two OpenAPI routes, and receives the action descriptor plus the
originating `Request`:

```typescript
import { AuthenticationError } from 'laikacms/core';

const api = buildJsonApi({
  repo: mySettingsProvider,
  authorize: async ({ action, request }) => {
    const user = await myAuth(request);
    if (!user) return new AuthenticationError('Missing token'); // → 401
    return user.isAdmin || action === 'readOpenApi'; // false → 403
  },
});
```

`authorize` decides _what a caller may do_; it does not authenticate them for you. Either validate
the credential inside the callback (as above), or mount the handler behind
[`@laikacms/server/api`](../../../../server/src/api), which authenticates a Bearer token and applies
its own `authorize` gate before forwarding.

For a surface that is _deliberately_ open — a dev server on loopback, a test harness, or a handler
already behind an authenticating proxy — say so explicitly with `allowAll`:

```typescript
import { allowAll } from 'laikacms/json-api';

const api = buildJsonApi({ repo: mySettingsProvider, authorize: allowAll });
```

Naming it rather than inlining `() => true` means every intentionally-open surface in a deployment
is one `rg 'authorize: allowAll'` away during an audit.

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { buildJsonApi } from 'laikacms/catalog-api';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { FileSystemStorageRepository } from 'laikacms/storage-fs';
import { jsonSerializer } from 'laikacms/storage-serializers-json';

const storage = new FileSystemStorageRepository('./content', { json: jsonSerializer }, 'json');
const settings = new ConventionCatalogProvider({ storage });
const api = buildJsonApi({ repo: settings, authorize: myPolicy });
export default { fetch: api.fetch };
```

## Endpoints

| Method | Path                | Status | Description               |
| ------ | ------------------- | ------ | ------------------------- |
| GET    | `/openapi.json`     | 200    | OpenAPI 3.1 specification |
| GET    | `/collections`      | 200    | List all collections      |
| GET    | `/collections/:key` | 200    | Read a single collection  |
| POST   | `/collections`      | 201    | Create a collection       |
| PATCH  | `/collections/:key` | 200    | Update a collection       |
| DELETE | `/collections/:key` | 204    | Delete a collection       |

All responses carry `Cache-Control: no-store`.

## Resource types

The API uses two JSON:API resource types:

| Resource type         | Collection type  | Description             |
| --------------------- | ---------------- | ----------------------- |
| `document-collection` | `type: document` | Document content folder |
| `media-collection`    | `type: media`    | Media/binary folder     |

### `document-collection` attributes

| Attribute                | Type                                | Required | Description                                                      |
| ------------------------ | ----------------------------------- | -------- | ---------------------------------------------------------------- |
| `type`                   | `"document"`                        | yes      | Discriminator                                                    |
| `name`                   | string                              | no       | Human-readable label                                             |
| `directory`              | string                              | no       | Storage root directory for this collection                       |
| `recursive`              | boolean                             | no       | Include sub-directories in listings                              |
| `format`                 | string                              | no       | Default file format (e.g. `"markdown"`)                          |
| `documentTitleKey`       | string                              | no       | Frontmatter key used as the document title                       |
| `documentDescriptionKey` | string                              | no       | Frontmatter key used as the document description                 |
| `documentStatusKey`      | string                              | no       | Frontmatter key used as the document status                      |
| `unpublishedStatuses`    | `Record<string, {directory, name}>` | no       | Draft/archive/trash status → directory mapping                   |
| `revisionDirectory`      | string                              | no       | Directory for revision snapshots                                 |
| `draftDirectory`         | string                              | no       | Directory for drafts (shorthand for `unpublishedStatuses.draft`) |
| `archiveDirectory`       | string                              | no       | Directory for archived documents                                 |
| `trashDirectory`         | string                              | no       | Directory for trashed documents                                  |

### `media-collection` attributes

| Attribute    | Type      | Required | Description                                |
| ------------ | --------- | -------- | ------------------------------------------ |
| `type`       | `"media"` | yes      | Discriminator                              |
| `name`       | string    | no       | Human-readable label                       |
| `directory`  | string    | no       | Storage root directory for this collection |
| `recursive`  | boolean   | no       | Include sub-directories in listings        |
| `accept`     | string[]  | no       | Allowed MIME types or file extensions      |
| `url`        | string    | no       | Public URL prefix for served media files   |
| `pathFormat` | string    | no       | Template for generating media file paths   |

## Request / response examples

### GET /collections

**Response 200:**

```json
{
  "data": [
    {
      "type": "document-collection",
      "id": "posts",
      "attributes": { "type": "document", "name": "Posts", "directory": "content/posts" }
    },
    {
      "type": "media-collection",
      "id": "images",
      "attributes": { "type": "media", "name": "Images", "directory": "public/uploads" }
    }
  ]
}
```

### POST /collections

**Request:**

```json
{
  "data": {
    "type": "document-collection",
    "id": "articles",
    "attributes": { "type": "document", "name": "Articles", "directory": "content/articles" }
  }
}
```

**Response 201:**

```json
{
  "data": {
    "type": "document-collection",
    "id": "articles",
    "attributes": { "type": "document", "name": "Articles", "directory": "content/articles" }
  }
}
```

### PATCH /collections/:key

`data.id` must match the URL `:key`. A mismatch returns `409 Conflict`.

**Request:**

```json
{
  "data": {
    "type": "document-collection",
    "id": "articles",
    "attributes": { "type": "document", "name": "All Articles", "recursive": true }
  }
}
```

**Response 200:** same shape as POST response.

### DELETE /collections/:key

**Response 204** — empty body.

## Error responses

Errors follow JSON:API format:

```json
{
  "errors": [
    {
      "status": "404",
      "title": "not_found",
      "detail": "Collection 'missing' not found."
    }
  ]
}
```

| HTTP status | When                                            |
| ----------- | ----------------------------------------------- |
| 400         | Malformed body or invalid JSON:API schema       |
| 404         | Collection key does not exist                   |
| 409         | `data.id` in PATCH body differs from URL `:key` |
| 503         | Downstream service (e.g. DynamoDB) unreachable  |

## Options

```typescript
interface CatalogApiOptions {
  repo: CatalogProvider;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
  authorize: CatalogAuthorize;
}
```

| Option      | Type                                              | Default | Description                                                                                                                                                                                                                                                                                                   |
| ----------- | ------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repo`      | `CatalogProvider`                                 | —       | Required. The settings provider to read/write collections.                                                                                                                                                                                                                                                    |
| `basePath`  | `string`                                          | `''`    | Mount path advertised in the `servers` URL of the served OpenAPI document. The Hono app is prefix-agnostic; mount it at this path.                                                                                                                                                                            |
| `onError`   | `(error: unknown) => void`                        | —       | Called with each fatal error before the JSON:API error response is returned. Use for logging or Sentry breadcrumbs.                                                                                                                                                                                           |
| `logger`    | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>` | —       | Passed to the JSON:API error serialiser for structured error logging.                                                                                                                                                                                                                                         |
| `authorize` | `CatalogAuthorize`                                | —       | **Required.** Per-action authorization policy. Runs before every action (including the OpenAPI routes) with the action descriptor and originating `Request`. Return `true` to allow, `false` for 403, or a `LaikaError` for a custom status/message. Pass `allowAll` to declare a surface intentionally open. |
