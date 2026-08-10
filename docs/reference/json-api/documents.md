# Documents API

The Documents API manages content with a publish/unpublish lifecycle. Documents exist in one of two
states:

- **Published** (`type: "published"`) — live, public content.
- **Unpublished** (`type: "unpublished"`) — drafts, pending-review, archived, or trashed content
  distinguished by a `status` string.

> ⚠️ **You must state an access policy.** `buildJsonApi` requires an `authorize` callback — it runs
> before every action below, including the two OpenAPI routes, and receives the action descriptor
> plus the originating `Request`. Return `true` to allow, `false` for a 403, or a `LaikaError` for a
> custom status. It decides _what a caller may do_; authenticating them is still your job — validate
> the credential inside the callback, or mount the handler behind `@laikacms/server/api`, which
> checks a Bearer token first. For a deliberately open surface, say so with `authorize: allowAll`
> from `laikacms/json-api`.

Revisions record snapshots of published documents.

### Resource Types

| JSON:API type            | Domain entity           | Description                                              |
| ------------------------ | ----------------------- | -------------------------------------------------------- |
| `published`              | `Document`              | Live published document                                  |
| `published-summary`      | `DocumentSummary`       | Published document without content                       |
| `unpublished`            | `Unpublished`           | Draft or otherwise unpublished document                  |
| `unpublished-summary`    | `UnpublishedSummary`    | Unpublished document without content                     |
| `revision`               | `Revision`              | Immutable historical snapshot                            |
| `revision-summary`       | `RevisionSummary`       | Revision without content                                 |
| `documents-capabilities` | `DocumentsCapabilities` | Repository capabilities; returned by `GET /capabilities` |

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
          "description": "Underlying documents repository capabilities"
        },
        {
          "path": "/sync-token",
          "methods": ["GET"],
          "description": "Get an opaque per-scope change token (capability-gated)"
        },
        {
          "path": "/changes",
          "methods": ["GET"],
          "description": "List changes since a sync token (capability-gated)"
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

#### GET /openapi.json

Returns the OpenAPI 3.1 specification for the Documents API as a JSON document.

**Response** — `200 OK`, `Content-Type: application/json`

The response body is an OpenAPI 3.1.0 document. The `servers` array is rewritten to the absolute
mount point so the document is usable as-is by code generators and API clients.

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Documents API", "version": "1.0.0" },
  "servers": [{ "url": "https://example.com/api/documents" }],
  "paths": { ... }
}
```

---

#### GET /openapi.yaml

Returns the same OpenAPI 3.1 specification as `GET /openapi.json`, serialized as YAML.

**Response** — `200 OK`, `Content-Type: application/yaml`

---

#### GET /capabilities

Returns the capabilities advertised by the underlying documents repository. Clients should call this
before attempting cursor pagination — the `attributes.pagination.styles.cursor` field indicates
whether the backend supports `page[after]` / `page[before]`. Sending cursor params to a backend that
does not support them returns a `400 Bad Request`.

**Response** — a single `documents-capabilities` resource

```json
{
  "data": {
    "type": "documents-capabilities",
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
      "versionTracking": {
        "supported": false,
        "description": "This backend does not attach per-document version tokens."
      },
      "changes": {
        "supported": false,
        "description": "This backend does not support change signals."
      }
    },
    "links": {
      "self": "/api/documents/capabilities"
    }
  }
}
```

A backend that supports version tracking and change signals would include:

```json
{
  "versionTracking": {
    "supported": true,
    "description": "A git commit SHA or database row version is exposed as the document version token."
  },
  "changes": {
    "supported": true,
    "description": "Sync tokens and change feeds are supported.",
    "syncToken": true,
    "changeFeed": true
  }
}
```

When `pagination.supported` is `false` the `styles` field is absent. `versionTracking` and `changes`
are always present. The `compatibilityDate` is set by each backend and changes when the repository's
contract evolves — clients may use it to detect incompatible backend versions.

---

#### GET /records

List records (published and/or unpublished) with full content for a given collection folder.

**Query Parameters**

| Parameter        | Type                                        | Required | Default       | Description                                                                                                                                                                            |
| ---------------- | ------------------------------------------- | -------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter[folder]` | string                                      | no       | `""`          | Collection (folder) to list from, e.g. `posts` or `posts/drafts`. Omit or pass an empty string to list all collections as `folder` resources (one per configured document collection). |
| `filter[type]`   | `"published"` \| `"unpublished"` \| `"all"` | no       | `"published"` | Filter by document state                                                                                                                                                               |
| `filter[depth]`  | number                                      | no       | `1`           | Traversal depth (minimum 1)                                                                                                                                                            |
| `page[number]`   | number                                      | no       | `1`           | Page number for page-based pagination (1-based)                                                                                                                                        |
| `page[size]`     | number                                      | no       | `10`          | Items per page — combines with `page[number]`, `page[after]`, or `page[before]`                                                                                                        |
| `page[offset]`   | number                                      | no       | —             | Zero-based item offset for offset-based pagination                                                                                                                                     |
| `page[limit]`    | number                                      | no       | —             | Maximum number of items to return — combines with `page[offset]`                                                                                                                       |
| `page[after]`    | string                                      | no       | —             | Forward cursor; rejected with 400 if the backend does not support cursor pagination (check `GET /capabilities`)                                                                        |
| `page[before]`   | string                                      | no       | —             | Backward cursor; rejected with 400 if the backend does not support cursor pagination (check `GET /capabilities`)                                                                       |

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
parameters as `GET /records`. When `filter[folder]` is omitted or empty, returns one
`folder-summary` resource per configured document collection.

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

| Field                      | Type          | Required | Description                                                           |
| -------------------------- | ------------- | -------- | --------------------------------------------------------------------- |
| `data.type`                | `"published"` | yes      | Resource type                                                         |
| `data.id`                  | string        | **yes**  | Document key (e.g. `"posts/my-doc"`)                                  |
| `data.attributes.language` | string        | no       | BCP 47 language tag (e.g. `"en"`); defaults to `"und"` (undetermined) |
| `data.attributes.content`  | object        | no       | Arbitrary document content                                            |

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

| Field                      | Type            | Required | Description                                             |
| -------------------------- | --------------- | -------- | ------------------------------------------------------- |
| `data.type`                | `"unpublished"` | yes      | Resource type                                           |
| `data.id`                  | string          | **yes**  | Document key (e.g. `"posts/my-doc"`)                    |
| `data.attributes.status`   | string          | yes      | Initial status (e.g. `"draft"`)                         |
| `data.attributes.language` | string          | no       | BCP 47 language tag; defaults to `"und"` (undetermined) |
| `data.attributes.content`  | object          | no       | Arbitrary document content                              |

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

| Field                      | Type         | Required | Description                                             |
| -------------------------- | ------------ | -------- | ------------------------------------------------------- |
| `data.type`                | `"revision"` | yes      | Resource type                                           |
| `data.id`                  | string       | yes      | Document key (e.g. `posts/my-doc`)                      |
| `data.attributes.revision` | string       | yes      | Revision identifier (e.g. a version tag or hash)        |
| `data.attributes.language` | string       | no       | BCP 47 language tag; defaults to `"und"` (undetermined) |
| `data.attributes.content`  | object       | no       | Snapshot of the document content                        |

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

| Parameter      | Type   | Default | Description                               |
| -------------- | ------ | ------- | ----------------------------------------- |
| `page[after]`  | string | —       | Forward cursor for pagination             |
| `page[before]` | string | —       | Backward cursor for pagination            |
| `page[size]`   | number | —       | Items per page; max 100, clamped silently |

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

#### GET /sync-token

Returns an opaque sync token representing the current state of the documents repository (or a
specific folder). Use the token with `GET /changes` to poll for changes since a known point.

> **Capability-gated** — backends that do not support change signals return `501 Not Implemented`.
> Check `GET /capabilities` before calling this endpoint.

**Query Parameters**

| Parameter        | Type   | Required | Description                                                                         |
| ---------------- | ------ | -------- | ----------------------------------------------------------------------------------- |
| `filter[folder]` | string | no       | Scope the token to a specific folder (e.g. `posts`). Omit to get a repo-wide token. |

**Response** — a single `sync-token` resource

```json
{
  "data": {
    "type": "sync-token",
    "id": "self",
    "attributes": {
      "syncToken": "eyJzZXEiOjQyfQ=="
    }
  }
}
```

When scoped to a folder the response includes a `folder` attribute:

```json
{
  "data": {
    "type": "sync-token",
    "id": "posts",
    "attributes": {
      "syncToken": "eyJzZXEiOjQyfQ==",
      "folder": "posts"
    }
  }
}
```

**Error Responses**

| Status | Condition                                                              |
| ------ | ---------------------------------------------------------------------- |
| `501`  | Backend does not support change signals (`NotImplementedError`)        |
| `403`  | Caller is not authorised to call `getSyncToken` (`AuthorizationError`) |

---

#### GET /changes

List change events since a previously obtained sync token. Returns one `change-summary` resource per
changed key, and a new `meta.syncToken` to use on the next poll.

> **Capability-gated** — backends that do not support change signals return `501 Not Implemented`.
> Check `GET /capabilities` before calling this endpoint.

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
      "id": "posts/hello-world",
      "attributes": {
        "deleted": false,
        "version": "abc123"
      }
    },
    {
      "type": "change-summary",
      "id": "posts/old-draft",
      "attributes": {
        "deleted": true
      }
    }
  ],
  "meta": {
    "page": { "total": 2 },
    "syncToken": "eyJzZXEiOjQzfQ=="
  }
}
```

The `meta.syncToken` value is the cursor for the next call. `attributes.version` is present only
when the backend includes per-document version tokens; `attributes.deleted: true` indicates a key
was removed since the prior token.

**Error Responses**

| Status | Condition                                                             |
| ------ | --------------------------------------------------------------------- |
| `400`  | `filter[since]` is absent                                             |
| `501`  | Backend does not support change signals (`NotImplementedError`)       |
| `403`  | Caller is not authorised to call `listChanges` (`AuthorizationError`) |
