# laikacms/documents-api

JSON:API server for document management (published documents, unpublished drafts, revisions, and
atomic operations).

## ⚠️ Authentication

`buildJsonApi` ships **no authentication middleware**. The handler will gladly read, create, update,
publish, unpublish, and delete documents and revisions for any caller that can reach its `fetch`. Do
**not** expose it to untrusted networks directly.

Wrap it with an authentication layer — e.g. [`@laikacms/decap/decap-api`](../../decap/decap-api),
which validates a Bearer access token before forwarding to this handler — or provide your own
middleware:

```typescript
const api = buildJsonApi({ repo: myDocumentsRepo });

export default {
  async fetch(request: Request) {
    const user = await myAuth(request);
    if (!user) return new Response('Unauthorized', { status: 401 });
    return api.fetch(request);
  },
};
```

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { buildJsonApi } from 'laikacms/documents-api';
// or the alias: import { buildJsonApi } from 'laikacms/documents/api';

const api = buildJsonApi({ repo: myDocumentsRepo });

// Wrap with authentication before exposing publicly — see warning above.
export default { fetch: api.fetch };
```

## Options

```typescript
interface DocumentsApiOptions {
  repo: DocumentsRepository;
  basePath?: string;
  onError?(error: unknown): void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'> | undefined;
}
```

| Option     | Type                                              | Default | Description                                                                                                                   |
| ---------- | ------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `repo`     | `DocumentsRepository`                             | —       | Required. The documents repository implementation to back the API.                                                            |
| `basePath` | `string`                                          | `''`    | URL prefix stripped from `request.url` before routing. Set to the mount path (e.g. `/documents`) when mounting at a sub-path. |
| `onError`  | `(error: unknown) => void`                        | —       | Called with each fatal error before the JSON:API error response is returned. Use for logging or Sentry breadcrumbs.           |
| `logger`   | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>` | —       | Passed to the JSON:API error serialiser for structured error logging.                                                         |

## Endpoints

| Method | Path                            | Status | Description                                                           |
| ------ | ------------------------------- | ------ | --------------------------------------------------------------------- |
| GET    | `/`                             | 200    | API info + endpoint discovery                                         |
| GET    | `/capabilities`                 | 200    | Repository capabilities (pagination styles, supported features)       |
| GET    | `/records`                      | 200    | List full records (published + unpublished view per key)              |
| GET    | `/record-summaries`             | 200    | List record summaries (lightweight listing, fewer attributes)         |
| POST   | `/published`                    | 201    | Create a published document                                           |
| GET    | `/published/{key}`              | 200    | Read a published document                                             |
| PATCH  | `/published/{key}`              | 200    | Update a published document                                           |
| DELETE | `/published/{key}`              | 200    | Delete a published document                                           |
| POST   | `/published/{key}/unpublish`    | 200    | State transition: move a published document to unpublished            |
| POST   | `/unpublished`                  | 201    | Create an unpublished draft                                           |
| GET    | `/unpublished/{key}`            | 200    | Read an unpublished draft                                             |
| PATCH  | `/unpublished/{key}`            | 200    | Update an unpublished draft                                           |
| DELETE | `/unpublished/{key}`            | 200    | Delete an unpublished draft                                           |
| POST   | `/unpublished/{key}/publish`    | 200    | State transition: publish an unpublished draft                        |
| POST   | `/revisions`                    | 201    | Create a revision for a document                                      |
| GET    | `/revisions/{key}`              | 200    | List revisions for a document key (paginated)                         |
| GET    | `/revisions/{key}/{revisionId}` | 200    | Read a specific revision                                              |
| POST   | `/operations`                   | 200    | Atomic batch operations (add / update / remove + publish / unpublish) |

All responses carry `Content-Type: application/vnd.api+json` and `Cache-Control: no-store`.

## Query parameters

### `GET /records` and `GET /record-summaries`

| Parameter        | Type                                    | Default       | Description                                                                                  |
| ---------------- | --------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `filter[type]`   | `'published' \| 'unpublished' \| 'all'` | `'published'` | Filter by document state. `'all'` returns both published and unpublished records.            |
| `filter[folder]` | `string`                                | `''`          | Limit results to the given folder path (e.g. `blog/`).                                       |
| `filter[depth]`  | `number` (≥ 1)                          | `1`           | Folder traversal depth. `1` returns only the immediate folder; higher values recurse.        |
| `page[size]`     | `number`                                | —             | Offset pagination: number of items per page.                                                 |
| `page[number]`   | `number`                                | —             | Offset pagination: 1-based page number.                                                      |
| `page[limit]`    | `number`                                | —             | Offset pagination alternative: maximum items to return.                                      |
| `page[offset]`   | `number`                                | —             | Offset pagination alternative: number of items to skip.                                      |
| `page[after]`    | `string`                                | —             | Cursor pagination: return items after this cursor. Requires cursor support in capabilities.  |
| `page[before]`   | `string`                                | —             | Cursor pagination: return items before this cursor. Requires cursor support in capabilities. |

Cursor pagination (`page[after]` / `page[before]`) returns `400` if the backing repository does not
declare cursor support in `GET /capabilities`. Use `page[number]` / `page[size]` or `page[offset]` /
`page[limit]` for offset-based backends.

### `GET /revisions/{key}`

Accepts the same pagination parameters as `/records`.

## Resource types

The API uses seven JSON:API resource types:

| Type                     | Returned by                                       |
| ------------------------ | ------------------------------------------------- |
| `published`              | Published document CRUD, publish state transition |
| `published-summary`      | `/record-summaries` for published entries         |
| `unpublished`            | Draft CRUD, unpublish state transition            |
| `unpublished-summary`    | `/record-summaries` for unpublished entries       |
| `revision`               | Revision create and detail                        |
| `revision-summary`       | Revision list (`GET /revisions/{key}`)            |
| `documents-capabilities` | `GET /capabilities`                               |

## Atomic operations (`POST /operations`)

The `/operations` endpoint accepts a JSON:API Atomic Operations document:

```jsonc
{
  "atomic:operations": [
    // Add an unpublished draft
    { "op": "add", "data": { "type": "unpublished", "attributes": { "title": "Draft" } } },
    // Add a published document
    {
      "op": "add",
      "data": { "type": "published", "id": "blog/hello", "attributes": { "title": "Hello" } }
    },
    // Publish an unpublished draft
    { "op": "update", "href": "/publish", "ref": { "type": "unpublished", "id": "blog/draft" } },
    // Unpublish a published document
    {
      "op": "update",
      "href": "/unpublish",
      "ref": { "type": "document", "id": "blog/hello" },
      "data": { "type": "unpublished", "attributes": { "status": "draft" } }
    },
    // Update draft content
    {
      "op": "update",
      "data": { "type": "unpublished", "id": "blog/draft", "attributes": { "title": "Updated" } }
    },
    // Remove a published document
    { "op": "remove", "ref": { "type": "document", "id": "blog/hello" } },
    // Remove a draft
    { "op": "remove", "ref": { "type": "unpublished", "id": "blog/draft" } }
  ]
}
```

Operations run in parallel. The response is an `atomic:results` array with one entry per operation:
a `data` object on success, a `meta: { deleted: true }` on remove success, or an `errors` array on
per-operation failure. The overall response status is always `200`; per-operation failures do not
abort the batch.

## Partial success: `meta.warnings`

Every response — single-resource, collection, void (delete), and per-result inside `atomic:results`
— may carry a `meta.warnings` array. Each entry is a JSON:API error object describing a non-fatal
recoverable issue surfaced by the backing repository.

`meta.warnings` is **additive** to the success of the operation. The response status is still `200`
(or `201` for creates); the resource is delivered; warnings describe what did not go cleanly. Fatal
failures populate the top-level `errors` array with a non-2xx status.

```jsonc
{
  "data": { "type": "published", "id": "blog/hello", "attributes": { "title": "Hello" } },
  "meta": {
    "warnings": [
      {
        "code": "not_found",
        "status": "404",
        "title": "Not Found",
        "detail": "readback failed after write; synthesized from input"
      }
    ]
  }
}
```

Collection responses also surface `meta.page.total` when the backing repository returns an aggregate
count:

```jsonc
{
  "data": [/* ... */],
  "links": { "next": "?page[number]=2" },
  "meta": { "page": { "total": 42 } }
}
```
