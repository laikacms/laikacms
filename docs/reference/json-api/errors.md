# Error Responses

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
