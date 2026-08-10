# Storage API

The Storage API manages a flat namespace of **atoms** (objects and folders). Keys are arbitrary
path-like strings (e.g. `posts/hello-world`). The API serves the root endpoint for meta-information
and then routes on the first path segment.

> ⚠️ **You must state an access policy.** `buildJsonApi` requires an `authorize` callback — it runs
> before every action below, including the two OpenAPI routes, and receives the action descriptor
> plus the originating `Request`. Return `true` to allow, `false` for a 403, or a `LaikaError` for a
> custom status. It decides _what a caller may do_; authenticating them is still your job — validate
> the credential inside the callback, or mount the handler behind `@laikacms/server/api`, which
> checks a Bearer token first. For a deliberately open surface, say so with `authorize: allowAll`
> from `laikacms/json-api`.

### Key Encoding

Object and folder keys are arbitrary path-like strings (e.g. `posts/hello-world`). When a key
contains slashes, those slashes **must be percent-encoded as `%2F`** in the URL path. The router
takes only the first path segment after the resource prefix as the key, so a raw slash is
interpreted as a new path segment rather than part of the key.

| Key                 | Correct URL path               | Wrong URL path               |
| ------------------- | ------------------------------ | ---------------------------- |
| `posts`             | `/objects/posts`               | —                            |
| `posts/hello-world` | `/objects/posts%2Fhello-world` | `/objects/posts/hello-world` |
| `a/b/c`             | `/objects/a%2Fb%2Fc`           | `/objects/a/b/c`             |

The same rule applies to `/folders/{key}`.

### Endpoints

---

#### GET /

Returns meta-information about the Storage API and its available endpoints.

**Response**

```json
{
  "data": {
    "type": "api-info",
    "id": "storage",
    "attributes": {
      "name": "Storage API",
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
          "description": "Underlying storage repository capabilities"
        },
        { "path": "/atoms", "methods": ["POST"], "description": "Create a folder" },
        { "path": "/atoms/{key}", "methods": ["GET"], "description": "List atoms in a folder" },
        {
          "path": "/atom-summaries/{key}",
          "methods": ["GET"],
          "description": "List atom summaries (lightweight listing) in a folder"
        },
        {
          "path": "/objects",
          "methods": ["POST"],
          "description": "Create a storage object"
        },
        {
          "path": "/objects/{key}",
          "methods": ["GET", "PATCH", "DELETE"],
          "description": "Read, update, or delete a storage object"
        },
        { "path": "/folders/{key}", "methods": ["GET"], "description": "Read a folder" },
        {
          "path": "/operations",
          "methods": ["POST"],
          "description": "Atomic operations (add, update, remove)"
        }
      ]
    }
  }
}
```

---

#### GET /openapi.json

Returns the OpenAPI 3.1 specification for the Storage API as a JSON document.

**Response** — `200 OK`, `Content-Type: application/json`

The response body is an OpenAPI 3.1.0 document. The `servers` array is rewritten to the absolute
mount point so the document is usable as-is by code generators and API clients.

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Storage API", "version": "1.0.0" },
  "servers": [{ "url": "https://example.com/api/storage" }],
  "paths": { ... }
}
```

---

#### GET /openapi.yaml

Returns the same OpenAPI 3.1 specification as `GET /openapi.json`, serialized as YAML.

**Response** — `200 OK`, `Content-Type: application/yaml`

---

#### GET /capabilities

Returns the capabilities advertised by the underlying storage repository. Clients should call this
before attempting cursor pagination — the `attributes.pagination.styles.cursor` field indicates
whether the backend supports `page[after]` / `page[before]`. Sending cursor params to a backend that
does not support them returns a `400 Bad Request`.

**Response** — a single `storage-capabilities` resource

```json
{
  "data": {
    "type": "storage-capabilities",
    "id": "self",
    "attributes": {
      "compatibilityDate": "2026-05-11",
      "pagination": {
        "supported": true,
        "description": "Offset and page pagination are supported. Cursor pagination is not.",
        "styles": {
          "offset": true,
          "page": true,
          "cursor": false
        }
      },
      "fileExtensions": {
        "supported": true,
        "description": "File extensions are tracked and mapped to serializer formats.",
        "supportedExtensions": {
          ".md": { "format": "markdown" },
          ".yaml": { "format": "yaml" },
          ".json": { "format": "json" }
        }
      },
      "changes": {
        "supported": false,
        "description": "This backend does not expose change signals."
      }
    },
    "links": {
      "self": "/api/storage/capabilities"
    }
  }
}
```

A backend that supports change signals and file-extension-less storage would include:

```json
{
  "fileExtensions": {
    "supported": false,
    "description": "This backend stores objects without file extension tracking."
  },
  "changes": {
    "supported": true,
    "description": "Sync tokens, change feeds, and live subscriptions are supported.",
    "syncToken": true,
    "changeFeed": true,
    "subscription": true
  }
}
```

When `pagination.supported` is `false` the `styles` field is absent. When `fileExtensions.supported`
is `false` the `supportedExtensions` field is absent. `changes` is always present. The
`compatibilityDate` is set by each backend and changes when the repository's contract evolves —
clients may use it to detect incompatible backend versions.

---

#### POST /atoms

Create a new folder.

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "folder",
    "id": "posts/drafts",
    "attributes": {}
  }
}
```

| Field             | Type       | Required | Description                      |
| ----------------- | ---------- | -------- | -------------------------------- |
| `data.type`       | `"folder"` | yes      | Resource type — must be `folder` |
| `data.id`         | string     | yes      | Key for the new folder           |
| `data.attributes` | object     | yes      | Attributes object (may be empty) |

**Response** — `201 Created` with the created folder resource

```json
{
  "data": {
    "type": "folder",
    "id": "posts/drafts",
    "attributes": {
      "type": "folder",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

**Error Responses**

| Status | Condition                                                    |
| ------ | ------------------------------------------------------------ |
| `400`  | Request body is missing, malformed JSON, or fails validation |

---

#### GET /atoms/:key

List all atoms (objects and folders) under the given key prefix. Returns full content for each atom.

Omitting `:key` (i.e. `GET /atoms`) lists root-level atoms — equivalent to `GET /atoms/` with an
empty key.

**Path Parameters**

| Parameter | Type   | Required | Description                                                                    |
| --------- | ------ | -------- | ------------------------------------------------------------------------------ |
| `key`     | string | No       | Folder key prefix to list atoms under (e.g. `posts`). Defaults to `''` (root). |

**Query Parameters**

| Parameter       | Type   | Default | Description                                                                                           |
| --------------- | ------ | ------- | ----------------------------------------------------------------------------------------------------- |
| `page[number]`  | number | —       | Page number (1-based) for page-based pagination                                                       |
| `page[size]`    | number | 100     | Items per page (page- and cursor-based). When no `page[*]` param is present, defaults to 100          |
| `page[offset]`  | number | —       | Zero-based offset for offset-based pagination                                                         |
| `page[limit]`   | number | —       | Maximum items for offset-based pagination                                                             |
| `page[after]`   | string | —       | Forward cursor. Rejected with 400 when backend capabilities report `pagination.styles.cursor: false`  |
| `page[before]`  | string | —       | Backward cursor. Rejected with 400 when backend capabilities report `pagination.styles.cursor: false` |
| `filter[depth]` | number | `1`     | Traversal depth (minimum 1)                                                                           |

> **Note:** Cursor params (`page[after]` / `page[before]`) are rejected with HTTP 400 on all
> built-in backends (FS, R2, WebDAV, Drizzle, libSQL, …) because they report
> `pagination.styles.cursor: false` in `GET /capabilities`. Use `page[number]`, `page[offset]`, or
> `page[limit]` for those backends.

**Response** — collection of `object` and/or `folder` resources

```json
{
  "data": [
    {
      "type": "object",
      "id": "posts/hello-world",
      "attributes": {
        "type": "object",
        "content": {
          "body": "This is my first post."
        },
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-16T08:00:00Z"
      }
    },
    {
      "type": "folder",
      "id": "posts/drafts",
      "attributes": {
        "type": "folder",
        "createdAt": "2024-01-10T09:00:00Z",
        "updatedAt": "2024-01-10T09:00:00Z"
      }
    }
  ],
  "links": {
    "self": "http://localhost:3000/atoms/posts",
    "first": "http://localhost:3000/atoms/posts",
    "next": "http://localhost:3000/atoms/posts?page[after]=posts%2Fdrafts",
    "prev": null,
    "last": null
  },
  "meta": {
    "page": {
      "total": 2
    }
  }
}
```

---

#### GET /atom-summaries/:key

List atom summaries (without full content) under the given key prefix. Useful for listing large
collections efficiently.

Omitting `:key` (i.e. `GET /atom-summaries`) lists root-level atom summaries — equivalent to
`GET /atom-summaries/` with an empty key.

**Path Parameters**

| Parameter | Type   | Required | Description                                                |
| --------- | ------ | -------- | ---------------------------------------------------------- |
| `key`     | string | No       | Folder key prefix (e.g. `posts`). Defaults to `''` (root). |

**Query Parameters**

Same as `GET /atoms/:key`.

**Response** — collection of `object-summary` and/or `folder-summary` resources

`createdAt` and `updatedAt` are optional — all built-in backends populate them, but a custom backend
may omit them.

```json
{
  "data": [
    {
      "type": "object-summary",
      "id": "posts/hello-world",
      "attributes": {
        "type": "object-summary",
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-16T08:00:00Z"
      }
    },
    {
      "type": "folder-summary",
      "id": "posts/drafts",
      "attributes": {
        "type": "folder-summary",
        "createdAt": "2024-01-10T09:00:00Z",
        "updatedAt": "2024-01-10T09:00:00Z"
      }
    }
  ],
  "links": {
    "self": "http://localhost:3000/atom-summaries/posts",
    "first": "http://localhost:3000/atom-summaries/posts",
    "next": null,
    "prev": null,
    "last": null
  },
  "meta": {
    "page": {
      "total": 2
    }
  }
}
```

---

#### POST /objects

Create a new storage object.

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "object",
    "id": "posts/hello-world",
    "attributes": {
      "content": {
        "body": "This is my first post."
      }
    }
  }
}
```

> **Note:** When using `rawSerializer` (the default in the Getting Started guide), only the `body`
> field is persisted. Passing any other fields (e.g. `title`) will throw an error at write time. Use
> `jsonSerializer` if you need to store multi-field content.
>
> `content` must always be an object — raw strings cannot be stored directly. To transport a raw
> string, the convention is to wrap it as `{ "body": "<content>" }`; markdown with frontmatter
> becomes `{ ...frontmatter, "body": "<markdown>" }`. See
> [the `body` convention](../../concepts/content-model#the-body-convention).

| Field                     | Type       | Required | Description                               |
| ------------------------- | ---------- | -------- | ----------------------------------------- |
| `data.type`               | `"object"` | yes      | Resource type                             |
| `data.id`                 | string     | yes      | The key for the new object                |
| `data.attributes.content` | object     | no       | Arbitrary JSON content (defaults to `{}`) |

**Response** — `201 Created` with the created object

```json
{
  "data": {
    "type": "object",
    "id": "posts/hello-world",
    "attributes": {
      "type": "object",
      "content": {
        "body": "This is my first post."
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

---

#### GET /objects/:key

Get a single storage object by key.

**Path Parameters**

| Parameter | Type   | Description                                                                      |
| --------- | ------ | -------------------------------------------------------------------------------- |
| `key`     | string | Key of the object (slashes must be encoded as `%2F`, e.g. `posts%2Fhello-world`) |

**Example**

```
GET /objects/posts%2Fhello-world
```

**Response** — the requested object

```json
{
  "data": {
    "type": "object",
    "id": "posts/hello-world",
    "attributes": {
      "type": "object",
      "content": {
        "title": "Hello World",
        "body": "This is my first post."
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-16T08:00:00Z"
    }
  }
}
```

**Error Response** — `404 Not Found` (also returned if the key is not encoded and the router
interprets it as a different path)

```json
{
  "errors": [
    {
      "status": "404",
      "code": "not_found",
      "detail": "The file at posts does not exist"
    }
  ]
}
```

---

#### PATCH /objects/:key

Update an existing storage object. The `id` in the request body must match the `:key` path
parameter.

**Path Parameters**

| Parameter | Type   | Description                                                                      |
| --------- | ------ | -------------------------------------------------------------------------------- |
| `key`     | string | Key of the object (slashes must be encoded as `%2F`, e.g. `posts%2Fhello-world`) |

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "object",
    "id": "posts/hello-world",
    "attributes": {
      "content": {
        "body": "Updated content."
      }
    }
  }
}
```

**Response** — updated object

```json
{
  "data": {
    "type": "object",
    "id": "posts/hello-world",
    "attributes": {
      "type": "object",
      "content": {
        "body": "Updated content."
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-16T08:00:00Z"
    }
  }
}
```

---

#### DELETE /objects/:key

Delete a storage object by key. Equivalent to using the `remove` operation in `POST /operations`.

**Path Parameters**

| Parameter | Type   | Description                                                                      |
| --------- | ------ | -------------------------------------------------------------------------------- |
| `key`     | string | Key of the object (slashes must be encoded as `%2F`, e.g. `posts%2Fhello-world`) |

**Example**

```
DELETE /objects/posts%2Fhello-world
```

**Response** — on success

```json
{
  "meta": {
    "deleted": true
  }
}
```

Returns `404` if the object does not exist.

> **Note:** Unsupported methods (e.g. `PUT`) on `/objects/{key}` return `405 Method Not Allowed`
> with an `Allow: GET, PATCH, DELETE` header.

---

#### GET /folders/:key

Get a single folder by key.

**Path Parameters**

| Parameter | Type   | Description                                                                 |
| --------- | ------ | --------------------------------------------------------------------------- |
| `key`     | string | Key of the folder (slashes must be encoded as `%2F`, e.g. `posts%2Fdrafts`) |

**Example**

```
GET /folders/posts%2Fdrafts
```

**Response**

```json
{
  "data": {
    "type": "folder",
    "id": "posts/drafts",
    "attributes": {
      "type": "folder",
      "createdAt": "2024-01-10T09:00:00Z",
      "updatedAt": "2024-01-10T09:00:00Z"
    }
  }
}
```

---

#### POST /operations

Execute a batch of atomic operations. Supports adding objects, adding folders, updating objects, and
removing atoms. All operations are processed in order; failed operations are omitted from
`atomic:results` — the response is HTTP 200 with a shorter result array (matching the OpenAPI spec).

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "atomic:operations": [
    {
      "op": "add",
      "data": {
        "type": "object",
        "id": "posts/new-post",
        "attributes": {
          "content": { "title": "New Post" }
        }
      }
    },
    {
      "op": "add",
      "data": {
        "type": "folder",
        "id": "posts/archive"
      }
    },
    {
      "op": "update",
      "data": {
        "type": "object",
        "id": "posts/hello-world",
        "attributes": {
          "content": { "title": "Updated Title" }
        }
      }
    },
    {
      "op": "remove",
      "ref": {
        "type": "atom",
        "id": "posts/old-post"
      }
    }
  ]
}
```

**Supported operation types**

| `op`     | Supported `data.type` / `ref.type` | Description                   |
| -------- | ---------------------------------- | ----------------------------- |
| `add`    | `"object"`, `"folder"`             | Create a new object or folder |
| `update` | `"object"`                         | Update an existing object     |
| `remove` | `"object"`, `"folder"`, `"atom"`   | Remove an existing atom       |

**Response**

Results are returned in the same order as the input operations. Remove operations return a `meta`
entry (same as the Documents API).

```json
{
  "atomic:results": [
    {
      "data": {
        "type": "object",
        "id": "posts/new-post",
        "attributes": {
          "type": "object",
          "content": { "title": "New Post" },
          "createdAt": "2024-01-15T10:30:00Z",
          "updatedAt": "2024-01-15T10:30:00Z"
        }
      }
    },
    {
      "data": {
        "type": "folder",
        "id": "posts/archive",
        "attributes": {
          "type": "folder",
          "createdAt": "2024-01-15T10:30:00Z",
          "updatedAt": "2024-01-15T10:30:00Z"
        }
      }
    },
    {
      "data": {
        "type": "object",
        "id": "posts/hello-world",
        "attributes": {
          "type": "object",
          "content": { "title": "Updated Title" },
          "createdAt": "2024-01-15T10:30:00Z",
          "updatedAt": "2024-01-16T08:00:00Z"
        }
      }
    },
    {
      "meta": {
        "deleted": true,
        "ref": {
          "type": "atom",
          "id": "posts/old-post"
        }
      }
    }
  ]
}
```
