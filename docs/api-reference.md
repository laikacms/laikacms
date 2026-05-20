# API Reference

## Overview

LaikaCMS exposes three HTTP API servers, each following the [JSON:API v1.1](https://jsonapi.org/) specification. All responses use the `application/vnd.api+json` content type.

| Server | Default Base Path | Purpose |
| --- | --- | --- |
| Storage API | configurable | Low-level key/value atom and folder storage |
| Documents API | configurable | Versioned content with publish/unpublish lifecycle |
| Assets API | `/api/assets` | Binary file and folder management |

### JSON:API Conventions

- Single resources are returned as `{ "data": { ... } }`.
- Collections are returned as `{ "data": [ ... ], "links": { ... }, "meta": { "page": { ... } } }`.
- Errors are returned as `{ "errors": [ { "status", "code", "detail" } ] }`.
- Atomic batch operations follow the [JSON:API Atomic Operations](https://jsonapi.org/ext/atomic/) extension: request body is `{ "atomic:operations": [ ... ] }`, response is `{ "atomic:results": [ ... ] }`.
- Cursor-based pagination is controlled with `page[cursor]` and `page[limit]` query parameters.

---

## Storage API

The Storage API manages a flat namespace of **atoms** (objects and folders). Keys are arbitrary path-like strings (e.g. `posts/hello-world`). The API serves the root endpoint for meta-information and then routes on the first path segment.

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
        { "path": "/atoms/{key}", "methods": ["GET"], "description": "List atoms in a folder" },
        { "path": "/objects/{key}", "methods": ["POST", "PATCH"], "description": "Create or update storage objects" },
        { "path": "/operations", "methods": ["POST"], "description": "Atomic operations (add, update, remove)" }
      ]
    }
  }
}
```

---

#### GET /atoms/:key

List all atoms (objects and folders) under the given key prefix. Returns full content for each atom.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Folder key prefix to list atoms under (e.g. `posts`) |

**Query Parameters**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `page[cursor]` | string | — | Cursor for pagination |
| `page[limit]` | number | 10 | Number of items per page |

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
          "title": "Hello World",
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
    "next": "http://localhost:3000/atoms/posts?page[cursor]=posts%2Fdrafts",
    "prev": null,
    "last": null
  },
  "meta": {
    "page": {
      "cursor": "posts/drafts",
      "hasMore": false
    }
  }
}
```

---

#### GET /atom-summaries/:key

List atom summaries (without full content) under the given key prefix. Useful for listing large collections efficiently.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Folder key prefix |

**Query Parameters**

Same as `GET /atoms/:key`.

**Response** — collection of `object-summary` and/or `folder-summary` resources

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
      "cursor": "posts/drafts",
      "hasMore": false
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
        "title": "Hello World",
        "body": "This is my first post."
      }
    }
  }
}
```

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"object"` | yes | Resource type |
| `data.id` | string | yes | The key for the new object |
| `data.attributes.content` | object | no | Arbitrary JSON content (defaults to `{}`) |

**Response** — `201 Created` with the created object

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
      "updatedAt": "2024-01-15T10:30:00Z"
    }
  }
}
```

---

#### PATCH /objects/:key

Update an existing storage object. The `id` in the request body must match the `:key` path parameter.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Key of the object to update |

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
        "title": "Hello World (Updated)",
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
        "title": "Hello World (Updated)",
        "body": "Updated content."
      },
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-16T08:00:00Z"
    }
  }
}
```

---

#### POST /operations

Execute a batch of atomic operations. Supports adding objects, adding folders, updating objects, and removing atoms. All operations are processed in order; failures for individual operations are surfaced per-entry in the response.

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

| `op` | Supported `data.type` / `ref.type` | Description |
| --- | --- | --- |
| `add` | `"object"`, `"folder"` | Create a new object or folder |
| `update` | `"object"` | Update an existing object |
| `remove` | `"object"`, `"folder"`, `"atom"` | Remove an existing atom |

**Response**

Results are returned in the same order as the input operations. Remove operations produce no result entry.

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
    }
  ]
}
```

---

## Documents API

The Documents API manages content with a publish/unpublish lifecycle. Documents exist in one of two states:

- **Published** (`type: "published"`) — live, public content.
- **Unpublished** (`type: "unpublished"`) — drafts, pending-review, archived, or trashed content distinguished by a `status` string.

Revisions record snapshots of published documents.

### Resource Types

| JSON:API type | Domain entity | Description |
| --- | --- | --- |
| `published` | `Document` | Live published document |
| `published-summary` | `DocumentSummary` | Published document without content |
| `unpublished` | `Unpublished` | Draft or otherwise unpublished document |
| `unpublished-summary` | `UnpublishedSummary` | Unpublished document without content |
| `revision` | `Revision` | Immutable historical snapshot |
| `revision-summary` | `RevisionSummary` | Revision without content |

### Endpoints

---

#### GET /

Returns a list of available endpoint names.

**Response**

```json
{
  "data": {
    "type": "endpoints",
    "id": "documents-api",
    "attributes": {
      "endpoints": [
        "records",
        "record-summaries",
        "published",
        "unpublished",
        "unpublished-summaries",
        "revisions",
        "operations"
      ]
    }
  }
}
```

---

#### GET /records

List all records (published and/or unpublished) with full content. Supports filtering by type, folder, and depth.

**Query Parameters**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `filter[type]` | `"published"` \| `"unpublished"` \| `"all"` | `"published"` | Filter by document state |
| `filter[folder]` | string | `""` | Folder path to list from |
| `filter[depth]` | number | `1` | Traversal depth (minimum 1) |
| `page[cursor]` | string | — | Pagination cursor |
| `page[limit]` | number | — | Items per page |

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

List all record summaries (without content). Accepts the same query parameters as `GET /records`.

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Document key (URL-encoded) |

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
      "code": "NOT_FOUND",
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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"published"` | yes | Resource type |
| `data.id` | string | no | Document key. Auto-generated if omitted |
| `data.attributes.language` | string | yes | BCP 47 language tag (e.g. `"en"`) |
| `data.attributes.content` | object | no | Arbitrary document content |

**Response** — `200 OK` with the created document

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Document key (URL-encoded) |

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Document key (URL-encoded) |

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Published document key (URL-encoded) |

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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"unpublished"` | yes | Resource type |
| `data.attributes.status` | string | yes | Target unpublished status (e.g. `"archived"`, `"trash"`) |

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Unpublished document key (URL-encoded) |

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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"unpublished"` | yes | Resource type |
| `data.id` | string | no | Document key. Auto-generated if omitted |
| `data.attributes.status` | string | yes | Initial status (e.g. `"draft"`) |
| `data.attributes.language` | string | yes | BCP 47 language tag |
| `data.attributes.content` | object | no | Arbitrary document content |

**Response** — created unpublished document (same shape as `GET /unpublished/:key`)

---

#### PATCH /unpublished/:key

Update an existing unpublished document.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Unpublished document key (URL-encoded) |

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Unpublished document key (URL-encoded) |

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Unpublished document key (URL-encoded) |

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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"revision"` | yes | Resource type |
| `data.id` | string | no | Document key. Auto-generated if omitted |
| `data.attributes.revision` | string | yes | Revision identifier (e.g. a version tag or hash) |
| `data.attributes.language` | string | yes | BCP 47 language tag |
| `data.attributes.content` | object | no | Snapshot of the document content |

**Response** — created revision

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Document key (URL-encoded) |

**Query Parameters**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `page[cursor]` | string | — | Pagination cursor |
| `page[limit]` | number | — | Items per page |

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
      "cursor": null,
      "hasMore": false
    }
  }
}
```

---

#### GET /revisions/:key/:revisionId

Get a single revision by document key and revision identifier.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Document key (URL-encoded) |
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

Execute a batch of atomic operations on documents. Supports adding published or unpublished documents, state transitions (publish/unpublish), content updates, and removals.

**Request Headers**

```
Content-Type: application/vnd.api+json
```

**Supported Operations**

| `op` | Required fields | Description |
| --- | --- | --- |
| `add` | `data` with `type: "unpublished"` or `"published"` | Create a document |
| `update` | `data` with `type: "unpublished"` and an `id` | Update unpublished content |
| `update` | `href: "/publish"`, `ref: { type: "unpublished", id }` | Publish an unpublished document |
| `update` | `href: "/unpublish"`, `ref: { type: "document", id }`, `data.attributes.status` | Unpublish a published document |
| `remove` | `ref` with `type: "document"` or `"unpublished"` | Delete a document |

**Request Body**

```json
{
  "atomic:operations": [
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

Results are returned in the same order as the input operations. Remove operations return a `meta` entry.

```json
{
  "atomic:results": [
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

**Error entries** (when an individual operation fails)

```json
{
  "atomic:results": [
    {
      "errors": [
        {
          "status": "400",
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

The Assets API manages binary files (assets) and folders. The default base path is `/api/assets`. All routes are mounted under `/resources`.

### Resource Types

| JSON:API type | Description |
| --- | --- |
| `asset` | A binary file with optional metadata |
| `folder` | A logical grouping of assets |
| `asset-metadata` | Detailed metadata for an asset (included resource) |
| `asset-url` | Public/private access URLs for an asset (included resource) |
| `asset-variation` | Derived variations of an asset, e.g. image thumbnails (included resource) |

### Included Resources

Pass `?include=<types>` as a comma-separated list to sideload related resources alongside `asset` results:

| Include value | Sideloaded type |
| --- | --- |
| `asset-metadata` | `asset-metadata` |
| `asset-url` | `asset-url` |
| `asset-variation` | `asset-variation` |

### Endpoints

---

#### GET /resources

List all assets and folders under a given folder prefix.

**Query Parameters**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `folder` or `filter[prefix]` | string | `""` | Folder key prefix to list |
| `filter[depth]` or `depth` | number | `1` | Traversal depth (minimum 1) |
| `page[limit]` | number | `100` | Items per page |
| `page[cursor]` | string | — | Cursor for pagination |
| `include` | string | — | Comma-separated list of related types to include |

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

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Resource key (URL-encoded, e.g. `images%2Fhero.jpg`) |

**Query Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `include` | string | Comma-separated: `asset-metadata`, `asset-url`, `asset-variation` |

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
          "thumbnail": "https://cdn.example.com/images/hero_thumb.jpg",
          "webp": "https://cdn.example.com/images/hero.webp"
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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `file` | File | yes | Binary file to upload |
| `key` | string | no | Asset key. Defaults to `file.name` |
| `mimeType` | string | no | MIME type. Defaults to `file.type` or `application/octet-stream` |
| `filename` | string | no | Filename. Defaults to `file.name` |
| `cacheControl` | string | no | `Cache-Control` header value |
| `customMetadata` | JSON string | no | `Record<string, string>` of custom metadata |
| `metadata` | JSON string | no | Alternative: JSON object with all the above fields |

**Example**

```bash
curl -X POST http://localhost:3002/api/assets/resources \
  -F "file=@hero.jpg" \
  -F "key=images/hero.jpg" \
  -F "mimeType=image/jpeg" \
  -F 'customMetadata={"alt":"Hero image"}'
```

**Response** — created `asset` resource

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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"asset"` | yes | Resource type |
| `data.id` | string | yes | Asset key |
| `data.attributes.mimeType` | string | no | MIME type (default: `application/octet-stream`) |
| `data.attributes.filename` | string | no | Original filename |
| `data.attributes.cacheControl` | string | no | Cache-Control header value |
| `data.attributes.customMetadata` | object | no | `Record<string, string>` |
| `data.attributes.content` | string | yes | Base64-encoded file content |

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

**Response** — created `folder` resource

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

Update metadata for an existing asset (MIME type, cache control, or custom metadata). The request body `data.type` must be `"asset"`.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Asset key (URL-encoded) |

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

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `data.type` | `"asset"` | yes | Resource type |
| `data.attributes.mimeType` | string | no | Updated MIME type |
| `data.attributes.cacheControl` | string | no | Updated Cache-Control value |
| `data.attributes.customMetadata` | object | no | Updated `Record<string, string>` |

**Response** — updated `asset` resource (same shape as `GET /resources/:key`)

---

#### DELETE /resources/:key

Delete an asset or folder.

**Path Parameters**

| Parameter | Type | Description |
| --- | --- | --- |
| `key` | string | Resource key (URL-encoded) |

**Query Parameters**

| Parameter | Type | Default | Description |
| --- | --- | --- | --- |
| `recursive` | `"true"` | `"false"` | Recursively delete folder contents |

**Response** — `204 No Content` (empty body)

---

## Error Responses

All three APIs return errors in JSON:API error format.

```json
{
  "errors": [
    {
      "status": "404",
      "code": "NOT_FOUND",
      "detail": "Resource not found: posts/missing"
    }
  ]
}
```

### Common Error Codes

| HTTP Status | Code | Description |
| --- | --- | --- |
| 400 | `INVALID_DATA` | Request body failed schema validation |
| 400 | `BAD_REQUEST` | Malformed request or unsupported operation |
| 400 | `validation_error` | Field-level validation failure (Assets API) |
| 404 | `NOT_FOUND` | Resource does not exist |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
