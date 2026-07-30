# Assets API

The Assets API manages binary files (assets) and folders. The default base path is `/api/assets`.
Resource routes are mounted under `/resources`; `GET /capabilities` sits directly on the base path.

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
the endpoint. `ContentBaseAssetsRepository` forwards the pagination capability of whichever storage
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
| `page[after]`                                   | string | —       | Forward cursor for pagination                                                                                                                           |
| `page[before]`                                  | string | —       | Backward cursor for pagination                                                                                                                          |
| `page[size]`                                    | number | `100`   | Items per page; max 100, clamped silently                                                                                                               |
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
