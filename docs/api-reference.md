# API Reference

All APIs follow [JSON:API](https://jsonapi.org/) specification.

## Storage API

Base path: `/api/storage`

| Method | Endpoint        | Description                    |
| ------ | --------------- | ------------------------------ |
| GET    | `/atoms`        | List atoms (objects + folders) |
| GET    | `/atoms/:key`   | Get single atom                |
| POST   | `/atoms`        | Create object                  |
| PATCH  | `/atoms/:key`   | Update object                  |
| DELETE | `/atoms/:key`   | Delete atom                    |
| POST   | `/atoms/atomic` | Batch operations               |

### Query Parameters

- `filter[prefix]` - Filter by key prefix
- `filter[depth]` - Folder depth (default: 1)
- `include=content` - Include object content

### Example

```bash
# List atoms
curl https://api.example.com/api/storage/atoms?filter[prefix]=posts/

# Create object
curl -X POST https://api.example.com/api/storage/atoms \
  -H "Content-Type: application/vnd.api+json" \
  -d '{"data":{"type":"atoms","attributes":{"key":"posts/hello","content":{"title":"Hello"}}}}'
```

## Documents API

Base path: `/api/documents`

| Method | Endpoint                   | Description     |
| ------ | -------------------------- | --------------- |
| GET    | `/documents`               | List documents  |
| GET    | `/documents/:id`           | Get document    |
| POST   | `/documents`               | Create document |
| PATCH  | `/documents/:id`           | Update document |
| DELETE | `/documents/:id`           | Delete document |
| GET    | `/unpublished`             | List drafts     |
| POST   | `/unpublished/:id/publish` | Publish draft   |

## Assets API

Base path: `/api/assets`

| Method | Endpoint      | Description        |
| ------ | ------------- | ------------------ |
| GET    | `/assets`     | List assets        |
| GET    | `/assets/:id` | Get asset metadata |
| POST   | `/assets`     | Upload asset       |
| DELETE | `/assets/:id` | Delete asset       |

### Upload

```bash
curl -X POST https://api.example.com/api/assets/assets \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@image.jpg"
```

## Error Responses

```json
{
  "errors": [{
    "status": "404",
    "code": "NOT_FOUND",
    "title": "Not Found",
    "detail": "Resource not found: posts/missing"
  }]
}
```

| Code           | Status | Description             |
| -------------- | ------ | ----------------------- |
| NOT_FOUND      | 404    | Resource not found      |
| INVALID_DATA   | 400    | Invalid request data    |
| UNAUTHORIZED   | 401    | Authentication required |
| FORBIDDEN      | 403    | Permission denied       |
| INTERNAL_ERROR | 500    | Server error            |
