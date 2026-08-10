# Assets API

The Assets API manages binary files (assets) and folders. The default base path is `/api/assets`.
Resource routes are mounted under `/resources`; `GET /capabilities` sits directly on the base path.

> ⚠️ **You must state an access policy.** `buildAssetsApi` requires an `authorize` callback — it runs
> before every action below, including the two OpenAPI routes, and receives the action descriptor
> plus the originating `Request`. Return `true` to allow, `false` for a 403, or a `LaikaError` for a
> custom status. It decides _what a caller may do_; authenticating them is still your job — validate
> the credential inside the callback, or mount the handler behind `@laikacms/server/api`, which
> checks a Bearer token first. For a deliberately open surface, say so with `authorize: allowAll`
> from `laikacms/json-api`.

### Resource Types

| JSON:API type         | Description                                                                   |
| --------------------- | ----------------------------------------------------------------------------- |
| `asset`               | A binary file with optional metadata                                          |
| `folder`              | A logical grouping of assets                                                  |
| `asset-metadata`      | Detailed metadata for an asset (included resource)                            |
| `asset-url`           | Public/private access URLs for an asset (included resource)                   |
| `asset-variation`     | Derived variations of an asset, e.g. image thumbnails (included resource)     |
| `assets-capabilities` | Repository capabilities (pagination support); returned by `GET /capabilities` |

### Included Resources

Pass `?include=<types>` as a comma-separated list to sideload related resources alongside `asset`
results. Both the canonical short name and the long-form JSON:API type name are accepted:

| Include value | Alias             | Sideloaded type   |
| ------------- | ----------------- | ----------------- |
| `urls`        | `asset-url`       | `asset-url`       |
| `variations`  | `asset-variation` | `asset-variation` |

> **Note:** Asset metadata (MIME type, size, dimensions, etc.) is **not** sideloaded via
> `?include=`. Use the separate `?meta=true` query parameter to inline metadata onto the primary
> resource's `data.meta` field instead.

### Endpoints

---

#### GET /

Returns meta-information about the Assets API and its available endpoints.

**Response**

```json
{
  "data": {
    "type": "api-info",
    "id": "assets",
    "attributes": {
      "name": "Assets API",
      "version": "1.0.0",
      "endpoints": [
        {
          "path": "/openapi.json",
          "methods": ["GET"],
          "description": "OpenAPI 3.1 specification for this API"
        },
        {
          "path": "/openapi.yaml",
          "methods": ["GET"],
          "description": "OpenAPI 3.1 specification for this API, as YAML"
        },
        {
          "path": "/capabilities",
          "methods": ["GET"],
          "description": "Underlying assets repository capabilities"
        },
        {
          "path": "/sync-token",
          "methods": ["GET"],
          "description": "Get an opaque change token (capability-gated)"
        },
        {
          "path": "/changes",
          "methods": ["GET"],
          "description": "List changes since a sync token (capability-gated)"
        },
        {
          "path": "/resources",
          "methods": ["GET", "POST"],
          "description": "List or create assets and folders"
        },
        {
          "path": "/resources/{key}",
          "methods": ["GET", "PATCH", "DELETE"],
          "description": "Read, update, or delete a resource"
        }
      ]
    }
  }
}
```

---

#### GET /openapi.json

Returns the OpenAPI 3.1 specification for the Assets API as a JSON document.

**Response** — `200 OK`, `Content-Type: application/json`

The response body is an OpenAPI 3.1.0 document. The `servers` array is rewritten to the absolute
mount point so the document is usable as-is by code generators and API clients.

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Assets API", "version": "1.0.0" },
  "servers": [{ "url": "https://example.com/api/assets" }],
  "paths": { ... }
}
```

---

#### GET /openapi.yaml

Returns the same OpenAPI 3.1 specification as `GET /openapi.json`, serialized as YAML.

**Response** — `200 OK`, `Content-Type: application/yaml`

---

#### GET /capabilities

Returns the capabilities advertised by the underlying assets repository. Clients should call this
before attempting cursor pagination — the `attributes.pagination.styles.cursor` field indicates
whether the backend supports `page[after]` / `page[before]`. Sending cursor params to a backend that
does not support them returns a `400 Bad Request`.

**Response** — a single `assets-capabilities` resource

```json
{
  "data": {
    "type": "assets-capabilities",
    "id": "self",
    "attributes": {
      "compatibilityDate": "2026-05-11",
      "pagination": {
        "supported": true,
        "description": "In-memory slicing applied after the full recursive walk; cursor pagination is not supported.",
        "styles": {
          "offset": true,
          "page": true,
          "cursor": false
        }
      },
      "versionTracking": {
        "supported": false,
        "description": "This backend does not attach per-asset version tokens."
      },
      "changes": {
        "supported": false,
        "description": "This backend does not support change signals."
      }
    },
    "links": {
      "self": "/api/assets/capabilities"
    }
  }
}
```

A backend that supports version tracking and named filters would include:

```json
{
  "versionTracking": {
    "supported": true,
    "description": "ETag from the underlying storage is exposed as the asset version token."
  },
  "changes": {
    "supported": true,
    "description": "Sync tokens and change feeds are supported.",
    "syncToken": true,
    "changeFeed": true
  },
  "filtering": {
    "supported": true,
    "description": "Named filters forwarded to the repository as filter[<name>] query params.",
    "filters": [
      { "name": "search", "description": "Full-text search over asset keys and metadata." }
    ]
  }
}
```

When `pagination.supported` is `false` the `styles` field is absent and only `description` is
present. `versionTracking` and `changes` are always present; `filtering` is absent when the backend
does not declare any named filters. The `compatibilityDate` is set by each backend and changes when
the repository's contract evolves — clients may use it to detect incompatible backend versions.

**Backend pagination support**

| Backend                    | `offset` | `page` | `cursor` |
| -------------------------- | -------- | ------ | -------- |
| `R2AssetsRepository`       | ✓        | ✓      | —        |
| `ObsidianAssetsRepository` | ✓        | ✓      | —        |

Two further backends advertise no fixed styles, so do not assume the table above covers you — call
the endpoint. `CatalogAssetsRepository` forwards the pagination capability of whichever storage
repository it wraps, and `AssetsJsonApiProxyRepository` returns whatever the upstream API's own
`GET /capabilities` reports (falling back to all three styles when the upstream does not answer).

**Error Responses**

| Status | Condition                                         |
| ------ | ------------------------------------------------- |
| `404`  | Repository returns `NotFoundError`                |
| `500`  | Repository returns an unrecognised internal error |

---

#### GET /resources

List all assets and folders under a given folder prefix.

**Query Parameters**

| Parameter                                       | Type   | Default | Description                                                                                                                                             |
| ----------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `folder`, `filter[folder]`, or `filter[prefix]` | string | `""`    | Folder key prefix to list (priority: `folder` > `filter[folder]` > `filter[prefix]`)                                                                    |
| `filter[depth]` or `depth`                      | number | `1`     | Traversal depth (minimum 1)                                                                                                                             |
| `filter[<name>]`                                | string | —       | Named filter declared by the backend in `GET /capabilities` `filtering.filters[].name`. Undeclared names return `400`. Check capabilities before using. |
| `page[number]`                                  | number | —       | Page number for page-based pagination (1-based)                                                                                                         |
| `page[size]`                                    | number | `100`   | Items per page — combines with `page[number]`, `page[after]`, or `page[before]`; max 100, clamped silently                                              |
| `page[offset]`                                  | number | —       | Zero-based item offset for offset-based pagination                                                                                                      |
| `page[limit]`                                   | number | —       | Maximum number of items to return — combines with `page[offset]`                                                                                        |
| `page[after]`                                   | string | —       | Forward cursor; rejected with 400 if the backend does not support cursor pagination (check `GET /capabilities`)                                         |
| `page[before]`                                  | string | —       | Backward cursor; rejected with 400 if the backend does not support cursor pagination (check `GET /capabilities`)                                        |
| `include`                                       | string | —       | Comma-separated: `urls` (or `asset-url`), `variations` (or `asset-variation`)                                                                           |
| `meta`                                          | string | —       | Set `meta=true` to inline asset metadata onto `data.meta`                                                                                               |

**Response** — collection of `asset` and `folder` resources with optional `included`

```json
{
  "data": [
    {
      "type": "asset",
      "id": "images/hero.jpg",
      "attributes": {
        "type": "asset",
        "content": {},
        "createdAt": "2024-01-10T09:00:00Z",
        "updatedAt": "2024-01-10T09:00:00Z"
      },
      "relationships": {
        "metadata": { "data": { "type": "asset-metadata", "id": "images/hero.jpg" } },
        "urls": { "data": { "type": "asset-url", "id": "images/hero.jpg" } },
        "variations": { "data": { "type": "asset-variation", "id": "images/hero.jpg" } }
      }
    },
    {
      "type": "folder",
      "id": "images/thumbnails",
      "attributes": {
        "type": "folder",
        "createdAt": "2024-01-05T08:00:00Z",
        "updatedAt": "2024-01-05T08:00:00Z"
      }
    }
  ],
  "included": [
    {
      "type": "asset-metadata",
      "id": "images/hero.jpg",
      "attributes": {
        "mimeType": "image/jpeg",
        "size": 204800,
        "filename": "hero.jpg",
        "customMetadata": {
          "alt": "Hero image"
        }
      }
    },
    {
      "type": "asset-url",
      "id": "images/hero.jpg",
      "attributes": {
        "url": "https://cdn.example.com/images/hero.jpg",
        "expiresAt": null
      }
    }
  ],
  "links": {
    "self": "http://localhost:3002/api/assets/resources?folder=images",
    "first": "http://localhost:3002/api/assets/resources?folder=images",
    "next": null,
    "prev": null,
    "last": null
  }
}
```

---

#### GET /resources/:key

Get a single resource (asset or folder) by key. Supports sideloading related data via `?include=`.

**Path Parameters**

| Parameter | Type   | Description                                          |
| --------- | ------ | ---------------------------------------------------- |
| `key`     | string | Resource key (URL-encoded, e.g. `images%2Fhero.jpg`) |

**Query Parameters**

| Parameter | Type   | Description                                                                   |
| --------- | ------ | ----------------------------------------------------------------------------- |
| `include` | string | Comma-separated: `urls` (or `asset-url`), `variations` (or `asset-variation`) |
| `meta`    | string | Set `meta=true` to inline asset metadata onto `data.meta`                     |

**Response**

```json
{
  "data": {
    "type": "asset",
    "id": "images/hero.jpg",
    "attributes": {
      "type": "asset",
      "content": {},
      "createdAt": "2024-01-10T09:00:00Z",
      "updatedAt": "2024-01-10T09:00:00Z"
    },
    "relationships": {
      "metadata": { "data": { "type": "asset-metadata", "id": "images/hero.jpg" } },
      "urls": { "data": { "type": "asset-url", "id": "images/hero.jpg" } },
      "variations": { "data": { "type": "asset-variation", "id": "images/hero.jpg" } }
    }
  },
  "included": [
    {
      "type": "asset-metadata",
      "id": "images/hero.jpg",
      "attributes": {
        "mimeType": "image/jpeg",
        "size": 204800,
        "filename": "hero.jpg",
        "cacheControl": "public, max-age=31536000",
        "customMetadata": {
          "alt": "Hero image"
        }
      }
    },
    {
      "type": "asset-url",
      "id": "images/hero.jpg",
      "attributes": {
        "url": "https://cdn.example.com/images/hero.jpg",
        "expiresAt": null
      }
    },
    {
      "type": "asset-variation",
      "id": "images/hero.jpg",
      "attributes": {
        "variations": {
          "thumbnail": {
            "variant": "thumbnail",
            "url": "https://cdn.example.com/images/hero_thumb.jpg",
            "width": 200,
            "height": 150,
            "mimeType": "image/jpeg"
          },
          "webp": {
            "variant": "webp",
            "url": "https://cdn.example.com/images/hero.webp",
            "mimeType": "image/webp"
          }
        }
      }
    }
  ]
}
```

**Error Response** — `404 Not Found`

```json
{
  "errors": [
    {
      "status": "404",
      "code": "not_found",
      "detail": "Resource not found"
    }
  ]
}
```

---

#### POST /resources

Create a new asset or folder. Accepts two content types.

##### Option A: Multipart form data (binary file upload)

**Request Headers**

```
Content-Type: multipart/form-data
```

**Form Fields**

| Field            | Type        | Required | Description                                                      |
| ---------------- | ----------- | -------- | ---------------------------------------------------------------- |
| `file`           | File        | yes      | Binary file to upload                                            |
| `key`            | string      | no       | Asset key. Defaults to `file.name`                               |
| `mimeType`       | string      | no       | MIME type. Defaults to `file.type` or `application/octet-stream` |
| `filename`       | string      | no       | Filename. Defaults to `file.name`                                |
| `cacheControl`   | string      | no       | `Cache-Control` header value                                     |
| `customMetadata` | JSON string | no       | `Record<string, string>` of custom metadata                      |
| `metadata`       | JSON string | no       | Alternative: JSON object with all the above fields               |

**Example**

```bash
curl -X POST http://localhost:3002/api/assets/resources \
  -F "file=@hero.jpg" \
  -F "key=images/hero.jpg" \
  -F "mimeType=image/jpeg" \
  -F 'customMetadata={"alt":"Hero image"}'
```

**Response** — `201 Created` — created `asset` resource

```json
{
  "data": {
    "type": "asset",
    "id": "images/hero.jpg",
    "attributes": {
      "type": "asset",
      "content": {},
      "createdAt": "2024-01-10T09:00:00Z",
      "updatedAt": "2024-01-10T09:00:00Z"
    },
    "relationships": {
      "metadata": { "data": { "type": "asset-metadata", "id": "images/hero.jpg" } },
      "urls": { "data": { "type": "asset-url", "id": "images/hero.jpg" } },
      "variations": { "data": { "type": "asset-variation", "id": "images/hero.jpg" } }
    }
  }
}
```

##### Option B: JSON:API — create asset with base64-encoded content

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "asset",
    "id": "images/logo.png",
    "attributes": {
      "mimeType": "image/png",
      "filename": "logo.png",
      "cacheControl": "public, max-age=86400",
      "customMetadata": {
        "alt": "Company logo"
      },
      "content": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    }
  }
}
```

| Field                            | Type      | Required | Description                                     |
| -------------------------------- | --------- | -------- | ----------------------------------------------- |
| `data.type`                      | `"asset"` | yes      | Resource type                                   |
| `data.id`                        | string    | yes      | Asset key                                       |
| `data.attributes.mimeType`       | string    | no       | MIME type (default: `application/octet-stream`) |
| `data.attributes.filename`       | string    | no       | Original filename                               |
| `data.attributes.cacheControl`   | string    | no       | Cache-Control header value                      |
| `data.attributes.customMetadata` | object    | no       | `Record<string, string>`                        |
| `data.attributes.content`        | string    | yes      | Base64-encoded file content                     |

##### Option C: JSON:API — create folder

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "folder",
    "id": "images/thumbnails"
  }
}
```

**Response** — `201 Created` — created `folder` resource

```json
{
  "data": {
    "type": "folder",
    "id": "images/thumbnails",
    "attributes": {
      "type": "folder",
      "createdAt": "2024-01-10T09:00:00Z",
      "updatedAt": "2024-01-10T09:00:00Z"
    }
  }
}
```

---

#### PATCH /resources/:key

Update metadata for an existing asset (MIME type, cache control, or custom metadata). The request
body `data.type` must be `"asset"`.

**Path Parameters**

| Parameter | Type   | Description             |
| --------- | ------ | ----------------------- |
| `key`     | string | Asset key (URL-encoded) |

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "asset",
    "attributes": {
      "mimeType": "image/webp",
      "cacheControl": "public, max-age=604800",
      "customMetadata": {
        "alt": "Updated hero image"
      }
    }
  }
}
```

| Field                            | Type      | Required | Description                      |
| -------------------------------- | --------- | -------- | -------------------------------- |
| `data.type`                      | `"asset"` | yes      | Resource type                    |
| `data.attributes.mimeType`       | string    | no       | Updated MIME type                |
| `data.attributes.cacheControl`   | string    | no       | Updated Cache-Control value      |
| `data.attributes.customMetadata` | object    | no       | Updated `Record<string, string>` |

**Response** — updated `asset` resource (same shape as `GET /resources/:key`)

---

#### DELETE /resources/:key

Delete an asset or folder.

**Path Parameters**

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| `key`     | string | Resource key (URL-encoded) |

**Query Parameters**

| Parameter   | Type     | Default   | Description                        |
| ----------- | -------- | --------- | ---------------------------------- |
| `recursive` | `"true"` | `"false"` | Recursively delete folder contents |

**Response**

| Status           | Condition                                                                                          | Body                                                 |
| ---------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `204 No Content` | Clean delete, no warnings                                                                          | empty                                                |
| `200 OK`         | Delete succeeded with recoverable warnings (e.g. a variation or CDN invalidation partially failed) | `{ "meta": { "deleted": true, "warnings": [...] } }` |

**`200` response body example (partial success with warnings):**

```json
{
  "meta": {
    "deleted": true,
    "warnings": [
      {
        "code": "not_found",
        "title": "Not Found",
        "detail": "Variation 'thumb_200' could not be deleted — object not found in storage"
      }
    ]
  }
}
```

> **Note:** Clients that check `response.status === 204` to confirm deletion must also handle `200`
> — both statuses indicate a successful delete. The `200` body surfaces actionable detail about what
> partially failed; clients that ignore warnings can treat any `2xx` as success.

---

#### GET /sync-token

Returns an opaque sync token representing the current state of the assets repository (or a specific
folder). Use the token with `GET /changes` to poll for changed or deleted assets since a known
point.

> **Capability-gated** — backends that do not support change signals return `501 Not Implemented`.
> Check `attributes.changes.supported` in `GET /capabilities` before calling this endpoint.

**Query Parameters**

| Parameter        | Type   | Required | Description                                                                          |
| ---------------- | ------ | -------- | ------------------------------------------------------------------------------------ |
| `filter[folder]` | string | no       | Scope the token to a specific folder (e.g. `images`). Omit to get a repo-wide token. |

**Response** — a single `sync-token` resource

```json
{
  "data": {
    "type": "sync-token",
    "id": "self",
    "attributes": {
      "syncToken": "eyJlcG9jaCI6MTcwMH0="
    }
  }
}
```

When scoped to a folder the response includes a `folder` attribute:

```json
{
  "data": {
    "type": "sync-token",
    "id": "images",
    "attributes": {
      "syncToken": "eyJlcG9jaCI6MTcwMH0=",
      "folder": "images"
    }
  }
}
```

**Error Responses**

| Status | Condition                                                          |
| ------ | ------------------------------------------------------------------ |
| `501`  | Backend does not support change signals (`NotImplementedError`)    |
| `403`  | Caller is not authorised to call `getSyncToken` (`ForbiddenError`) |

---

#### GET /changes

List asset change events since a previously obtained sync token. Returns one `change-summary`
resource per changed key, and a new `meta.syncToken` to use on the next poll.

> **Capability-gated** — backends that do not support change signals return `501 Not Implemented`.
> Check `attributes.changes.supported` in `GET /capabilities` before calling this endpoint.

**Query Parameters**

| Parameter        | Type   | Required | Description                                                                                    |
| ---------------- | ------ | -------- | ---------------------------------------------------------------------------------------------- |
| `filter[since]`  | string | **yes**  | Sync token from a prior `GET /sync-token` or `GET /changes` response. Returns `400` if absent. |
| `filter[folder]` | string | no       | Restrict change feed to a specific folder. Should match the folder used to obtain the token.   |

**Response** — collection of `change-summary` resources

```json
{
  "data": [
    {
      "type": "change-summary",
      "id": "images/hero.jpg",
      "attributes": {
        "deleted": false,
        "version": "etag-abc123"
      }
    },
    {
      "type": "change-summary",
      "id": "images/old-logo.png",
      "attributes": {
        "deleted": true
      }
    }
  ],
  "meta": {
    "page": { "total": 2 },
    "syncToken": "eyJlcG9jaCI6MTcwMX0="
  }
}
```

The `meta.syncToken` value is the cursor for the next call. `attributes.version` is present only
when the backend supports version tracking (`attributes.versionTracking.supported: true` in
`GET /capabilities`). `attributes.deleted: true` indicates the asset was removed since the prior
token.

**Error Responses**

| Status | Condition                                                         |
| ------ | ----------------------------------------------------------------- |
| `400`  | `filter[since]` is absent                                         |
| `501`  | Backend does not support change signals (`NotImplementedError`)   |
| `403`  | Caller is not authorised to call `listChanges` (`ForbiddenError`) |
