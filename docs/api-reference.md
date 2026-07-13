# API Reference

## Overview

LaikaCMS exposes three HTTP API servers, each following the [JSON:API v1.1](https://jsonapi.org/)
specification. All responses use the `application/vnd.api+json` content type.

| Server          | Default Base Path | Purpose                                            |
| --------------- | ----------------- | -------------------------------------------------- |
| Storage API     | configurable      | Low-level key/value atom and folder storage        |
| Documents API   | configurable      | Versioned content with publish/unpublish lifecycle |
| Assets API      | `/api/assets`     | Binary file and folder management                  |
| ContentBase API | configurable      | Collection settings (document and media folders)   |

### JSON:API Conventions

- Single resources are returned as `{ "data": { ... } }`.
- Collections are returned as `{ "data": [ ... ], "links": { ... }, "meta": { "page": { ... } } }`.
- Errors are returned as `{ "errors": [ { "status", "code", "detail" } ] }`.
- The Documents API `/operations` endpoint is a **fail-fast batch** (not a JSON:API Atomic
  Operations extension): request body is `{ "operations": [ ... ] }`, response is
  `{ "results": [ ... ] }`. Pre-flight validates all ops before any I/O; a shape-invalid batch
  returns 400 with zero writes. A mid-batch repository failure stops processing but does not roll
  back prior ops.
- Cursor-based pagination is controlled with `page[after]` (forward) / `page[before]` (backward) and
  `page[size]` query parameters. Offset-based pagination uses `page[offset]` and `page[limit]`.
  **Cursor pagination is backend-specific.** Not all storage backends support `page[after]` /
  `page[before]`; backends like `FileSystemStorageRepository` and `R2StorageRepository` only support
  offset- and page-based pagination. Sending a cursor param to an unsupported backend returns a
  `400 Bad Request` with a `invalid_data` error. Inspect `GET /capabilities`
  (`attributes.pagination.styles.cursor`) to confirm cursor support before using these params.

---

## Storage API

The Storage API manages a flat namespace of **atoms** (objects and folders). Keys are arbitrary
path-like strings (e.g. `posts/hello-world`). The API serves the root endpoint for meta-information
and then routes on the first path segment.

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
          "path": "/capabilities",
          "methods": ["GET"],
          "description": "Underlying storage repository capabilities"
        },
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

| Parameter       | Type   | Default | Description                    |
| --------------- | ------ | ------- | ------------------------------ |
| `page[after]`   | string | —       | Forward cursor for pagination  |
| `page[before]`  | string | —       | Backward cursor for pagination |
| `page[size]`    | number | 10      | Number of items per page       |
| `filter[depth]` | number | `1`     | Traversal depth (minimum 1)    |

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
removing atoms. All operations are processed in order; failures for individual operations are
surfaced per-entry in the response.

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

---

## Documents API

The Documents API manages content with a publish/unpublish lifecycle. Documents exist in one of two
states:

- **Published** (`type: "published"`) — live, public content.
- **Unpublished** (`type: "unpublished"`) — drafts, pending-review, archived, or trashed content
  distinguished by a `status` string.

Revisions record snapshots of published documents.

### Resource Types

| JSON:API type         | Domain entity        | Description                             |
| --------------------- | -------------------- | --------------------------------------- |
| `published`           | `Document`           | Live published document                 |
| `published-summary`   | `DocumentSummary`    | Published document without content      |
| `unpublished`         | `Unpublished`        | Draft or otherwise unpublished document |
| `unpublished-summary` | `UnpublishedSummary` | Unpublished document without content    |
| `revision`            | `Revision`           | Immutable historical snapshot           |
| `revision-summary`    | `RevisionSummary`    | Revision without content                |

### Endpoints

---

#### GET /

Returns meta-information about the Documents API and its available endpoints.

**Response**

```json
{
  "data": {
    "type": "api-info",
    "id": "documents",
    "attributes": {
      "name": "Documents API",
      "version": "1.0.0",
      "endpoints": [
        {
          "path": "/capabilities",
          "methods": ["GET"],
          "description": "Underlying documents repository capabilities"
        },
        {
          "path": "/records",
          "methods": ["GET"],
          "description": "List full records (published + unpublished view per key)"
        },
        {
          "path": "/record-summaries",
          "methods": ["GET"],
          "description": "List record summaries (lightweight listing)"
        },
        {
          "path": "/published",
          "methods": ["POST"],
          "description": "Create a published document"
        },
        {
          "path": "/published/{key}",
          "methods": ["GET", "PATCH", "DELETE"],
          "description": "Read, update, or remove a published document"
        },
        {
          "path": "/published/{key}/unpublish",
          "methods": ["POST"],
          "description": "State transition: move a published document to unpublished"
        },
        {
          "path": "/unpublished",
          "methods": ["POST"],
          "description": "Create an unpublished draft"
        },
        {
          "path": "/unpublished/{key}",
          "methods": ["GET", "PATCH", "DELETE"],
          "description": "Read, update, or remove an unpublished draft"
        },
        {
          "path": "/unpublished/{key}/publish",
          "methods": ["POST"],
          "description": "State transition: publish an unpublished draft"
        },
        {
          "path": "/revisions",
          "methods": ["POST"],
          "description": "Create a revision for a document"
        },
        {
          "path": "/revisions/{key}",
          "methods": ["GET"],
          "description": "List revisions for a document"
        },
        {
          "path": "/revisions/{key}/{revisionId}",
          "methods": ["GET"],
          "description": "Read a specific revision of a document"
        },
        {
          "path": "/operations",
          "methods": ["POST"],
          "description": "Atomic operations (add/update/remove + publish/unpublish transitions)"
        }
      ]
    }
  }
}
```

---

#### GET /records

List records (published and/or unpublished) with full content for a given collection folder.

**Query Parameters**

| Parameter        | Type                                        | Required | Default       | Description                                                      |
| ---------------- | ------------------------------------------- | -------- | ------------- | ---------------------------------------------------------------- |
| `filter[folder]` | string                                      | **yes**  | —             | Collection (folder) to list from, e.g. `posts` or `posts/drafts` |
| `filter[type]`   | `"published"` \| `"unpublished"` \| `"all"` | no       | `"published"` | Filter by document state                                         |
| `filter[depth]`  | number                                      | no       | `1`           | Traversal depth (minimum 1)                                      |
| `page[after]`    | string                                      | no       | —             | Forward cursor for pagination                                    |
| `page[before]`   | string                                      | no       | —             | Backward cursor for pagination                                   |
| `page[size]`     | number                                      | no       | —             | Items per page                                                   |

> **Note:** `filter[folder]` is required and identifies the collection to list. Omitting it or
> passing an empty string returns `400 bad_request`. To list documents across multiple collections,
> make one request per collection.

**Response** — mixed array of `published` and `unpublished` resources

```json
{
  "data": [
    {
      "type": "published",
      "id": "posts/hello-world",
      "attributes": {
        "type": "published",
        "status": "published",
        "language": "en",
        "content": {
          "title": "Hello World",
          "body": "This is my first post."
        },
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-16T08:00:00Z"
      }
    },
    {
      "type": "unpublished",
      "id": "posts/draft-post",
      "attributes": {
        "type": "unpublished",
        "status": "draft",
        "language": "en",
        "content": {
          "title": "Draft Post",
          "body": "Work in progress."
        },
        "createdAt": "2024-01-17T12:00:00Z",
        "updatedAt": "2024-01-17T12:00:00Z"
      }
    }
  ]
}
```

---

#### GET /record-summaries

List record summaries (without content) for a given collection folder. Accepts the same query
parameters as `GET /records`, including the required `filter[folder]`.

**Response** — mixed array of `published-summary` and `unpublished-summary` resources

```json
{
  "data": [
    {
      "type": "published-summary",
      "id": "posts/hello-world",
      "attributes": {
        "type": "published-summary",
        "status": "published",
        "createdAt": "2024-01-15T10:30:00Z",
        "updatedAt": "2024-01-16T08:00:00Z"
      }
    },
    {
      "type": "unpublished-summary",
      "id": "posts/draft-post",
      "attributes": {
        "type": "unpublished-summary",
        "status": "draft",
        "createdAt": "2024-01-17T12:00:00Z",
        "updatedAt": "2024-01-17T12:00:00Z"
      }
    }
  ]
}
```

---

#### GET /published/:key

Get a single published document by key.

**Path Parameters**

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| `key`     | string | Document key (URL-encoded) |

**Response**

```json
{
  "data": {
    "type": "published",
    "id": "posts/hello-world",
    "attributes": {
      "type": "published",
      "status": "published",
      "language": "en",
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

**Error Response** — `404 Not Found`

```json
{
  "errors": [
    {
      "status": "404",
      "code": "not_found",
      "detail": "Document not found"
    }
  ]
}
```

---

#### POST /published

Create a new published document directly.

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "published",
    "id": "posts/hello-world",
    "attributes": {
      "language": "en",
      "content": {
        "title": "Hello World",
        "body": "This is my first post."
      }
    }
  }
}
```

| Field                      | Type          | Required | Description                          |
| -------------------------- | ------------- | -------- | ------------------------------------ |
| `data.type`                | `"published"` | yes      | Resource type                        |
| `data.id`                  | string        | **yes**  | Document key (e.g. `"posts/my-doc"`) |
| `data.attributes.language` | string        | yes      | BCP 47 language tag (e.g. `"en"`)    |
| `data.attributes.content`  | object        | no       | Arbitrary document content           |

**Response** — `201 Created` with the created document

```json
{
  "data": {
    "type": "published",
    "id": "posts/hello-world",
    "attributes": {
      "type": "published",
      "status": "published",
      "language": "en",
      "content": {
        "title": "Hello World",
        "body": "This is my first post."
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

---

#### PATCH /published/:key

Update an existing published document.

**Path Parameters**

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| `key`     | string | Document key (URL-encoded) |

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "published",
    "id": "posts/hello-world",
    "attributes": {
      "content": {
        "title": "Hello World (v2)",
        "body": "Updated content."
      }
    }
  }
}
```

**Response** — updated document (same shape as `GET /published/:key`)

---

#### DELETE /published/:key

Delete a published document.

**Path Parameters**

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| `key`     | string | Document key (URL-encoded) |

**Response** — `200 OK`

```json
{
  "meta": {
    "deleted": true
  }
}
```

---

#### POST /published/:key/unpublish

Move a published document to the unpublished state with the given status.

**Path Parameters**

| Parameter | Type   | Description                          |
| --------- | ------ | ------------------------------------ |
| `key`     | string | Published document key (URL-encoded) |

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "unpublished",
    "attributes": {
      "status": "archived"
    }
  }
}
```

| Field                    | Type            | Required | Description                                              |
| ------------------------ | --------------- | -------- | -------------------------------------------------------- |
| `data.type`              | `"unpublished"` | yes      | Resource type                                            |
| `data.attributes.status` | string          | yes      | Target unpublished status (e.g. `"archived"`, `"trash"`) |

**Response** — resulting unpublished document

```json
{
  "data": {
    "type": "unpublished",
    "id": "posts/hello-world",
    "attributes": {
      "type": "unpublished",
      "status": "archived",
      "language": "en",
      "content": {
        "title": "Hello World",
        "body": "This is my first post."
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-18T09:00:00Z"
    }
  }
}
```

---

#### GET /unpublished/:key

Get a single unpublished document by key.

**Path Parameters**

| Parameter | Type   | Description                            |
| --------- | ------ | -------------------------------------- |
| `key`     | string | Unpublished document key (URL-encoded) |

**Response**

```json
{
  "data": {
    "type": "unpublished",
    "id": "posts/draft-post",
    "attributes": {
      "type": "unpublished",
      "status": "draft",
      "language": "en",
      "content": {
        "title": "Draft Post",
        "body": "Work in progress."
      },
      "createdAt": "2024-01-17T12:00:00Z",
      "updatedAt": "2024-01-17T12:00:00Z"
    }
  }
}
```

---

#### POST /unpublished

Create a new unpublished document (draft or other unpublished status).

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "unpublished",
    "id": "posts/draft-post",
    "attributes": {
      "status": "draft",
      "language": "en",
      "content": {
        "title": "Draft Post",
        "body": "Work in progress."
      }
    }
  }
}
```

| Field                      | Type            | Required | Description                          |
| -------------------------- | --------------- | -------- | ------------------------------------ |
| `data.type`                | `"unpublished"` | yes      | Resource type                        |
| `data.id`                  | string          | **yes**  | Document key (e.g. `"posts/my-doc"`) |
| `data.attributes.status`   | string          | yes      | Initial status (e.g. `"draft"`)      |
| `data.attributes.language` | string          | yes      | BCP 47 language tag                  |
| `data.attributes.content`  | object          | no       | Arbitrary document content           |

**Response** — `201 Created` — created unpublished document (same shape as `GET /unpublished/:key`)

---

#### PATCH /unpublished/:key

Update an existing unpublished document.

**Path Parameters**

| Parameter | Type   | Description                            |
| --------- | ------ | -------------------------------------- |
| `key`     | string | Unpublished document key (URL-encoded) |

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "unpublished",
    "id": "posts/draft-post",
    "attributes": {
      "status": "draft",
      "content": {
        "title": "Draft Post (Revised)",
        "body": "Revised content."
      }
    }
  }
}
```

**Response** — updated unpublished document (same shape as `GET /unpublished/:key`)

---

#### DELETE /unpublished/:key

Delete an unpublished document permanently.

**Path Parameters**

| Parameter | Type   | Description                            |
| --------- | ------ | -------------------------------------- |
| `key`     | string | Unpublished document key (URL-encoded) |

**Response** — `200 OK`

```json
{
  "meta": {
    "deleted": true
  }
}
```

---

#### POST /unpublished/:key/publish

Publish an unpublished document. Moves it to published state.

**Path Parameters**

| Parameter | Type   | Description                            |
| --------- | ------ | -------------------------------------- |
| `key`     | string | Unpublished document key (URL-encoded) |

**Request Body** — none required

**Response** — resulting published document

```json
{
  "data": {
    "type": "published",
    "id": "posts/draft-post",
    "attributes": {
      "type": "published",
      "status": "published",
      "language": "en",
      "content": {
        "title": "Draft Post (Revised)",
        "body": "Revised content."
      },
      "createdAt": "2024-01-17T12:00:00Z",
      "updatedAt": "2024-01-18T14:00:00Z"
    }
  }
}
```

---

#### POST /revisions

Create a revision snapshot for a document.

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Request Body**

```json
{
  "data": {
    "type": "revision",
    "id": "posts/hello-world",
    "attributes": {
      "revision": "v1.0.0",
      "language": "en",
      "content": {
        "title": "Hello World",
        "body": "Original content."
      }
    }
  }
}
```

| Field                      | Type         | Required | Description                                      |
| -------------------------- | ------------ | -------- | ------------------------------------------------ |
| `data.type`                | `"revision"` | yes      | Resource type                                    |
| `data.id`                  | string       | yes      | Document key (e.g. `posts/my-doc`)               |
| `data.attributes.revision` | string       | yes      | Revision identifier (e.g. a version tag or hash) |
| `data.attributes.language` | string       | yes      | BCP 47 language tag                              |
| `data.attributes.content`  | object       | no       | Snapshot of the document content                 |

**Response** — `201 Created` — created revision

```json
{
  "data": {
    "type": "revision",
    "id": "posts/hello-world",
    "attributes": {
      "type": "revision",
      "revision": "v1.0.0",
      "language": "en",
      "content": {
        "title": "Hello World",
        "body": "Original content."
      },
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

---

#### GET /revisions/:key

List revision summaries for a document key.

**Path Parameters**

| Parameter | Type   | Description                |
| --------- | ------ | -------------------------- |
| `key`     | string | Document key (URL-encoded) |

**Query Parameters**

| Parameter      | Type   | Default | Description                    |
| -------------- | ------ | ------- | ------------------------------ |
| `page[after]`  | string | —       | Forward cursor for pagination  |
| `page[before]` | string | —       | Backward cursor for pagination |
| `page[size]`   | number | —       | Items per page                 |

**Response** — collection of `revision-summary` resources

```json
{
  "data": [
    {
      "type": "revision-summary",
      "id": "posts/hello-world",
      "attributes": {
        "type": "revision-summary",
        "revision": "v1.0.0",
        "createdAt": "2024-01-15T10:30:00Z"
      }
    },
    {
      "type": "revision-summary",
      "id": "posts/hello-world",
      "attributes": {
        "type": "revision-summary",
        "revision": "v1.1.0",
        "createdAt": "2024-01-16T08:00:00Z"
      }
    }
  ],
  "links": {
    "self": "http://localhost:3001/revisions/posts%2Fhello-world",
    "first": "http://localhost:3001/revisions/posts%2Fhello-world",
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

#### GET /revisions/:key/:revisionId

Get a single revision by document key and revision identifier.

**Path Parameters**

| Parameter    | Type   | Description                         |
| ------------ | ------ | ----------------------------------- |
| `key`        | string | Document key (URL-encoded)          |
| `revisionId` | string | Revision identifier (e.g. `v1.0.0`) |

**Response**

```json
{
  "data": {
    "type": "revision",
    "id": "posts/hello-world",
    "attributes": {
      "type": "revision",
      "revision": "v1.0.0",
      "language": "en",
      "content": {
        "title": "Hello World",
        "body": "Original content."
      },
      "createdAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

---

#### POST /operations

Execute a fail-fast batch of operations on documents. Supports adding published or unpublished
documents, state transitions (publish/unpublish), content updates, and removals.

All operations are validated for request shape before any I/O. A shape-invalid batch returns 400
with zero writes. Valid batches are applied sequentially; the first repository failure stops
processing. A mid-batch repository failure leaves previously-applied ops applied — this endpoint is
a fail-fast batch, not a transaction.

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Supported Operations**

| `op`     | Required fields                                                                 | Description                     |
| -------- | ------------------------------------------------------------------------------- | ------------------------------- |
| `add`    | `data` with `type: "unpublished"` or `"published"`                              | Create a document               |
| `update` | `data` with `type: "unpublished"` and an `id`                                   | Update unpublished content      |
| `update` | `href: "/publish"`, `ref: { type: "unpublished", id }`                          | Publish an unpublished document |
| `update` | `href: "/unpublish"`, `ref: { type: "document", id }`, `data.attributes.status` | Unpublish a published document  |
| `remove` | `ref` with `type: "document"` or `"unpublished"`                                | Delete a document               |

**Request Body**

```json
{
  "operations": [
    {
      "op": "add",
      "data": {
        "type": "unpublished",
        "id": "posts/new-draft",
        "attributes": {
          "status": "draft",
          "language": "en",
          "content": { "title": "New Draft" }
        }
      }
    },
    {
      "op": "update",
      "href": "/publish",
      "ref": {
        "type": "unpublished",
        "id": "posts/ready-to-publish"
      }
    },
    {
      "op": "update",
      "href": "/unpublish",
      "ref": {
        "type": "document",
        "id": "posts/outdated"
      },
      "data": {
        "type": "unpublished",
        "attributes": {
          "status": "archived"
        }
      }
    },
    {
      "op": "update",
      "data": {
        "type": "unpublished",
        "id": "posts/new-draft",
        "attributes": {
          "status": "pending_review",
          "content": { "title": "New Draft (Updated)" }
        }
      }
    },
    {
      "op": "remove",
      "ref": {
        "type": "document",
        "id": "posts/to-delete"
      }
    }
  ]
}
```

**Response**

Results are returned in the same order as the applied operations (may be fewer than submitted if
processing stopped at a failure). Remove operations return a `meta` entry.

```json
{
  "results": [
    {
      "data": {
        "type": "unpublished",
        "id": "posts/new-draft",
        "attributes": {
          "type": "unpublished",
          "status": "draft",
          "language": "en",
          "content": { "title": "New Draft" },
          "createdAt": "2024-01-18T09:00:00Z",
          "updatedAt": "2024-01-18T09:00:00Z"
        }
      }
    },
    {
      "data": {
        "type": "published",
        "id": "posts/ready-to-publish",
        "attributes": {
          "type": "published",
          "status": "published",
          "language": "en",
          "content": { "title": "Ready to Publish" },
          "createdAt": "2024-01-17T10:00:00Z",
          "updatedAt": "2024-01-18T09:00:00Z"
        }
      }
    },
    {
      "data": {
        "type": "unpublished",
        "id": "posts/outdated",
        "attributes": {
          "type": "unpublished",
          "status": "archived",
          "language": "en",
          "content": { "title": "Outdated Post" },
          "createdAt": "2024-01-10T08:00:00Z",
          "updatedAt": "2024-01-18T09:00:00Z"
        }
      }
    },
    {
      "data": {
        "type": "unpublished",
        "id": "posts/new-draft",
        "attributes": {
          "type": "unpublished",
          "status": "pending_review",
          "language": "en",
          "content": { "title": "New Draft (Updated)" },
          "createdAt": "2024-01-18T09:00:00Z",
          "updatedAt": "2024-01-18T09:05:00Z"
        }
      }
    },
    {
      "meta": {
        "deleted": true,
        "ref": {
          "type": "document",
          "id": "posts/to-delete"
        }
      }
    }
  ]
}
```

**Error entries** (when a repository operation fails mid-batch)

```json
{
  "results": [
    {
      "errors": [
        {
          "status": "404",
          "title": "Operation Failed",
          "detail": "Document not found: posts/missing"
        }
      ]
    }
  ]
}
```

---

## Assets API

The Assets API manages binary files (assets) and folders. The default base path is `/api/assets`.
All routes are mounted under `/resources`.

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
      }
    },
    "links": {
      "self": "/api/assets/capabilities"
    }
  }
}
```

When `pagination.supported` is `false` the `styles` field is absent and only `description` is
present. The `compatibilityDate` is set by each backend and changes when the repository's contract
evolves — clients may use it to detect incompatible backend versions.

**Backend pagination support**

| Backend                    | `offset` | `page` | `cursor` |
| -------------------------- | -------- | ------ | -------- |
| `R2AssetsRepository`       | ✓        | ✓      | —        |
| `ObsidianAssetsRepository` | ✓        | ✓      | —        |

**Error Responses**

| Status | Condition                                         |
| ------ | ------------------------------------------------- |
| `404`  | Repository returns `NotFoundError`                |
| `500`  | Repository returns an unrecognised internal error |

---

#### GET /resources

List all assets and folders under a given folder prefix.

**Query Parameters**

| Parameter                                       | Type   | Default | Description                                                                          |
| ----------------------------------------------- | ------ | ------- | ------------------------------------------------------------------------------------ |
| `folder`, `filter[folder]`, or `filter[prefix]` | string | `""`    | Folder key prefix to list (priority: `folder` > `filter[folder]` > `filter[prefix]`) |
| `filter[depth]` or `depth`                      | number | `1`     | Traversal depth (minimum 1)                                                          |
| `page[after]`                                   | string | —       | Forward cursor for pagination                                                        |
| `page[before]`                                  | string | —       | Backward cursor for pagination                                                       |
| `page[size]`                                    | number | `100`   | Items per page                                                                       |
| `include`                                       | string | —       | Comma-separated: `urls` (or `asset-url`), `variations` (or `asset-variation`)        |
| `meta`                                          | string | —       | Set `meta=true` to inline asset metadata onto `data.meta`                            |

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

## ContentBase API

The ContentBase API manages collection settings — the named document and media folders that
structure a content base. It is served by `buildJsonApi` from `laikacms/contentbase-api`.

> ⚠️ **No authentication is included.** Wrap the handler with an auth layer (e.g.
> `@laikacms/decap/decap-api` or a custom Bearer-token middleware) before exposing it to untrusted
> networks — otherwise any caller can read, mutate, and delete collection settings.

### Resource Types

| Resource type         | `attributes.type` | Description                |
| --------------------- | ----------------- | -------------------------- |
| `document-collection` | `"document"`      | Document content folder    |
| `media-collection`    | `"media"`         | Media / binary file folder |

Both resource types use the collection `key` as the JSON:API `id`.

### Endpoints

| Method | Path                | Status | Description              |
| ------ | ------------------- | ------ | ------------------------ |
| GET    | `/collections`      | 200    | List all collections     |
| GET    | `/collections/:key` | 200    | Read a single collection |
| POST   | `/collections`      | 201    | Create a collection      |
| PATCH  | `/collections/:key` | 200    | Update a collection      |
| DELETE | `/collections/:key` | 204    | Delete a collection      |

All responses carry `Cache-Control: no-store`.

#### GET /collections

Returns all configured collections.

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

#### GET /collections/:key

Returns a single collection by key.

**Response 200:**

```json
{
  "data": {
    "type": "document-collection",
    "id": "posts",
    "attributes": {
      "type": "document",
      "name": "Posts",
      "directory": "content/posts",
      "recursive": false
    }
  }
}
```

**Response 404** — collection key does not exist:

```json
{ "errors": [{ "status": "404", "title": "not_found", "detail": "Collection 'posts' not found." }] }
```

#### POST /collections

Creates a new collection. Returns `201 Created` on success.

**Request** — document collection:

```json
{
  "data": {
    "type": "document-collection",
    "id": "articles",
    "attributes": {
      "type": "document",
      "name": "Articles",
      "directory": "content/articles",
      "recursive": true
    }
  }
}
```

**Request** — media collection:

```json
{
  "data": {
    "type": "media-collection",
    "id": "images",
    "attributes": {
      "type": "media",
      "name": "Images",
      "directory": "public/uploads",
      "accept": ["image/png", "image/jpeg", "image/webp"]
    }
  }
}
```

**Response 201** — echoes the created resource:

```json
{
  "data": {
    "type": "document-collection",
    "id": "articles",
    "attributes": {
      "type": "document",
      "name": "Articles",
      "directory": "content/articles",
      "recursive": true
    }
  }
}
```

**Response 400** — invalid body or unknown collection type.

#### PATCH /collections/:key

Updates an existing collection. `data.id` **must** match the URL `:key`; a mismatch returns
`409 Conflict`.

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

**Response 200** — same shape as POST 201, without status code.

**Response 404** — collection key does not exist:

```json
{
  "errors": [
    { "status": "404", "title": "not_found", "detail": "Collection 'articles' not found." }
  ]
}
```

**Response 409 Conflict** — `data.id` ≠ URL `:key`:

```json
{
  "errors": [{
    "status": "409",
    "title": "conflict",
    "detail": "Body data.id ('wrong-key') does not match URL key ('articles'). Use the URL key as the resource identifier."
  }]
}
```

#### DELETE /collections/:key

Deletes the collection with the given key.

**Response 204 No Content** — empty body.

**Response 404** — collection key does not exist.

---

## Error Responses

All four APIs return errors in JSON:API error format.

```json
{
  "errors": [
    {
      "status": "404",
      "code": "not_found",
      "detail": "Resource not found: posts/missing"
    }
  ]
}
```

### Common Error Codes

| HTTP Status | Code               | Description                                 |
| ----------- | ------------------ | ------------------------------------------- |
| 400         | `invalid_data`     | Request body failed schema validation       |
| 400         | `bad_request`      | Malformed request or unsupported operation  |
| 400         | `validation_error` | Field-level validation failure (Assets API) |
| 404         | `not_found`        | Resource does not exist                     |
| 500         | `internal_error`   | Unexpected server error                     |
