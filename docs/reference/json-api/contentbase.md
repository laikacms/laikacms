# ContentBase API

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
{
  "errors": [
    {
      "status": "404",
      "code": "not_found",
      "title": "Not Found",
      "detail": "Collection 'posts' not found."
    }
  ]
}
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
    {
      "status": "404",
      "code": "not_found",
      "title": "Not Found",
      "detail": "Collection 'articles' not found."
    }
  ]
}
```

**Response 409 Conflict** — `data.id` ≠ URL `:key`:

```json
{
  "errors": [{
    "status": "409",
    "code": "conflict",
    "title": "Conflict",
    "detail": "Body data.id ('wrong-key') does not match URL key ('articles'). Use the URL key as the resource identifier."
  }]
}
```

#### DELETE /collections/:key

Deletes the collection with the given key.

**Response 204 No Content** — empty body.

**Response 404** — collection key does not exist.
