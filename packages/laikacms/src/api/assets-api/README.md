# laikacms/assets-api

JSON:API server for binary asset management (files and folders).

## ⚠️ Access control

`buildAssetsApi` **requires** an `authorize` policy — there is no implicit default, because an API
that silently defaults to open is the failure mode this option exists to prevent. The callback runs
before every action, including the two OpenAPI routes, and receives the action descriptor plus the
originating `Request`:

```typescript
import { AuthenticationError } from 'laikacms/core';

const api = buildAssetsApi({
  repository: myAssetsRepo,
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

const api = buildAssetsApi({ repository: myAssetsRepo, authorize: allowAll });
```

Naming it rather than inlining `() => true` means every intentionally-open surface in a deployment
is one `rg 'authorize: allowAll'` away during an audit.

## Installation

```bash
pnpm add laikacms
```

## Usage

```typescript
import { buildAssetsApi } from 'laikacms/assets-api';
// or the alias: import { buildAssetsApi } from 'laikacms/assets/api';

const api = buildAssetsApi({ repository: myAssetsRepo, authorize: myPolicy });
export default { fetch: api.fetch };
```

## Options

```typescript
interface AssetsApiOptions {
  repository: AssetsRepository;
  basePath?: string;
  onError?: (error: unknown) => void;
  logger?: Pick<Console, 'error' | 'warn' | 'info' | 'debug'>;
  authorize: AssetsAuthorize;
}
```

| Option       | Type                                              | Default         | Description                                                                                                                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `repository` | `AssetsRepository`                                | —               | Required. The assets repository implementation to back the API.                                                                                                                                                                                                                                               |
| `basePath`   | `string`                                          | `'/api/assets'` | URL prefix stripped from `request.url` before routing. Set to the mount path (e.g. `/assets`) when mounting at a sub-path.                                                                                                                                                                                    |
| `onError`    | `(error: unknown) => void`                        | —               | Called with each fatal error before the JSON:API error response is returned. Use for logging or Sentry breadcrumbs.                                                                                                                                                                                           |
| `logger`     | `Pick<Console, 'error'\|'warn'\|'info'\|'debug'>` | —               | Passed to the JSON:API error serialiser for structured error logging.                                                                                                                                                                                                                                         |
| `authorize`  | `AssetsAuthorize`                                 | —               | **Required.** Per-action authorization policy. Runs before every action (including the OpenAPI routes) with the action descriptor and originating `Request`. Return `true` to allow, `false` for 403, or a `LaikaError` for a custom status/message. Pass `allowAll` to declare a surface intentionally open. |

## Endpoints

| Method | Path              | Status    | Description                                           |
| ------ | ----------------- | --------- | ----------------------------------------------------- |
| GET    | `/openapi.json`   | 200       | OpenAPI 3.1 specification                             |
| GET    | `/openapi.yaml`   | 200       | OpenAPI 3.1 specification, as YAML                    |
| GET    | `/capabilities`   | 200       | Repository capabilities (pagination styles, etc.)     |
| GET    | `/resources`      | 200       | List assets and folders under a folder prefix         |
| GET    | `/resources/:key` | 200       | Read a single asset or folder                         |
| POST   | `/resources`      | 201       | Upload an asset or create a folder                    |
| PATCH  | `/resources/:key` | 200       | Update asset metadata                                 |
| DELETE | `/resources/:key` | 204 / 200 | Delete an asset or folder (200 when warnings present) |

All responses carry `Content-Type: application/vnd.api+json` and `Cache-Control: no-store`.

### Resource types

| JSON:API type         | Description                                                                      |
| --------------------- | -------------------------------------------------------------------------------- |
| `asset`               | A binary file with optional metadata                                             |
| `folder`              | A logical grouping of assets                                                     |
| `asset-url`           | Public/private access URLs for an asset (sideloaded via `?include=urls`)         |
| `asset-variation`     | Derived variations, e.g. image thumbnails (sideloaded via `?include=variations`) |
| `assets-capabilities` | Capabilities object returned by `GET /capabilities`                              |

---

### GET /capabilities

Returns the underlying repository's capability flags so clients can introspect supported pagination
modes, version tracking, change signals, and named filters without guessing.

```json
{
  "data": {
    "type": "assets-capabilities",
    "id": "self",
    "attributes": {
      "compatibilityDate": "2026-05-11",
      "pagination": {
        "supported": true,
        "description": "In-memory slicing; cursor pagination not supported.",
        "styles": { "offset": true, "page": true, "cursor": false }
      },
      "versionTracking": {
        "supported": false,
        "description": "This backend does not attach per-asset version tokens."
      },
      "changes": {
        "supported": false,
        "description": "This backend does not support change signals."
      }
    }
  }
}
```

`versionTracking` and `changes` are always present. `filtering` is present only when the backend
declares named filters — when absent, no `filter[<name>]` params are accepted.

---

### GET /resources

List all assets and folders under a given folder prefix.

**Query Parameters**

| Parameter        | Aliases                            | Type   | Default | Description                                                                                             |
| ---------------- | ---------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------- |
| `folder`         | `filter[folder]`, `filter[prefix]` | string | `""`    | Folder key prefix to list. Priority: `folder` > `filter[folder]` > `filter[prefix]`                     |
| `filter[depth]`  | `depth`                            | number | `1`     | Traversal depth (minimum 1)                                                                             |
| `filter[<name>]` | —                                  | string | —       | Named filter declared in `GET /capabilities` `filtering.filters[].name`. Undeclared names return `400`. |
| `page[size]`     | —                                  | number | `100`   | Items per page                                                                                          |
| `page[number]`   | —                                  | number | —       | Page number for offset-based pagination (`page[number]=2` with `page[size]=10` → offset 10)             |
| `page[after]`    | —                                  | string | —       | Forward cursor for cursor-based pagination (requires backend support — check `GET /capabilities`)       |
| `page[before]`   | —                                  | string | —       | Backward cursor for cursor-based pagination                                                             |
| `include`        | —                                  | string | —       | Comma-separated: `urls` (alias `asset-url`), `variations` (alias `asset-variation`)                     |
| `meta`           | —                                  | string | —       | Set `meta=true` to inline asset metadata onto `data.meta`                                               |

> **Note on folder filter aliases:** Three query parameters select the folder prefix — `folder`,
> `filter[folder]`, and `filter[prefix]` — and are evaluated in that priority order. Only the first
> non-empty value is used. `filter[folder]` is functionally equivalent to `folder`; `filter[prefix]`
> is accepted for JSON:API filter-param convention compatibility. Prefer `folder` for new
> integrations.

> **Note on cursor pagination:** Sending `page[after]` or `page[before]` to a backend that does not
> support cursor pagination returns `400 Bad Request`. Inspect `GET /capabilities`
> (`attributes.pagination.styles.cursor`) before using these params.

**Response** — collection of `asset` and `folder` resources

```json
{
  "data": [
    {
      "type": "asset",
      "id": "images/hero.jpg",
      "attributes": {
        "type": "asset",
        "createdAt": "2024-01-10T09:00:00Z",
        "updatedAt": "2024-01-10T09:00:00Z"
      },
      "links": { "self": "/api/assets/resources/images%2Fhero.jpg" }
    },
    {
      "type": "folder",
      "id": "images/thumbnails",
      "attributes": {
        "type": "folder",
        "createdAt": "2024-01-05T08:00:00Z",
        "updatedAt": "2024-01-05T08:00:00Z"
      },
      "links": { "self": "/api/assets/resources/images%2Fthumbnails" }
    }
  ],
  "links": { "next": "/api/assets/resources?page[size]=100&page[after]=images%2Fhero.jpg" },
  "meta": { "page": { "total": 42 } }
}
```

---

### GET /resources/:key

Read a single asset or folder. The key must be percent-encoded when it contains slashes.

Supports the same `?include=` and `?meta=` query parameters as `GET /resources`.

```http
GET /api/assets/resources/images%2Fhero.jpg?include=urls&meta=true
```

---

### POST /resources

Create an asset or a folder.

**Upload an asset — `multipart/form-data`** (recommended for binary files):

| Field            | Required | Description                                                                            |
| ---------------- | -------- | -------------------------------------------------------------------------------------- |
| `file`           | yes      | The binary file to upload                                                              |
| `key`            | no       | Storage key (defaults to the file's name)                                              |
| `mimeType`       | no       | MIME type (defaults to the file's reported type)                                       |
| `filename`       | no       | Human-readable filename                                                                |
| `cacheControl`   | no       | `Cache-Control` header value for the stored object                                     |
| `customMetadata` | no       | JSON-encoded `Record<string, string>` of key/value pairs                               |
| `metadata`       | no       | JSON-encoded object covering all of the above fields (individual fields take priority) |

**Upload an asset — `application/vnd.api+json`** (for base64-encoded content):

```json
{
  "data": {
    "type": "asset",
    "id": "images/hero.jpg",
    "attributes": {
      "mimeType": "image/jpeg",
      "content": "<base64-encoded bytes>"
    }
  }
}
```

**Create a folder — `application/vnd.api+json`**:

```json
{
  "data": {
    "type": "folder",
    "id": "images/thumbnails"
  }
}
```

---

### PATCH /resources/:key

Update asset metadata. Only `mimeType`, `cacheControl`, and `customMetadata` can be patched; binary
content cannot be changed via PATCH (delete and re-upload instead).

```json
{
  "data": {
    "type": "asset",
    "attributes": {
      "customMetadata": { "alt": "Hero image — updated" }
    }
  }
}
```

---

### DELETE /resources/:key

Delete an asset or folder. Folders are deleted non-recursively by default; pass `?recursive=true` to
delete all nested assets and sub-folders.

**Response:** `204 No Content` on clean success. When warnings are present (e.g. some nested files
could not be deleted), returns `200` with a body so the warnings can be conveyed:

```json
{
  "meta": {
    "deleted": true,
    "warnings": [{ "code": "not_found", "status": "404", "title": "Not Found", "detail": "..." }]
  }
}
```

---

## Sideloading: `?include=`

Pass `?include=<types>` as a comma-separated list to sideload related resources alongside `asset`
results in the top-level `included` array. Both short aliases and full JSON:API type names are
accepted:

| `include` value | Full type alias   | Sideloaded JSON:API type |
| --------------- | ----------------- | ------------------------ |
| `urls`          | `asset-url`       | `asset-url`              |
| `variations`    | `asset-variation` | `asset-variation`        |

> **Metadata is not sideloaded via `?include=`.** Use the separate `?meta=true` parameter to inline
> metadata (MIME type, file size, dimensions, etc.) onto each asset's `data.meta` field. This is
> because metadata is an attribute of the asset, not an independent relationship resource.

---

## Partial success: `meta.warnings`

Single-resource, collection, and delete responses may all carry a `meta.warnings` array. Each entry
is a JSON:API error object describing a non-fatal recoverable issue surfaced by the backing
repository — for example, an unreadable sub-folder skipped during a recursive walk, or a variation
that could not be generated.

`meta.warnings` is **additive** to the success of the operation. The HTTP status is still `200` (or
`201` for create); the resource you asked for is delivered; the warnings list describes what else
did not go cleanly. Fatal failures continue to populate the top-level `errors` array with a non-2xx
status.

```jsonc
{
  "data": { "type": "asset", "id": "images/hero.jpg", "attributes": {/* ... */} },
  "meta": {
    "warnings": [
      {
        "code": "not_found",
        "status": "404",
        "title": "Not Found",
        "detail": "Variation thumbnail-sm could not be generated"
      }
    ]
  }
}
```
