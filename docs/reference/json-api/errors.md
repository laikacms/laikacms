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

## Error Codes

### 400 Bad Request

| Code               | Description                                 |
| ------------------ | ------------------------------------------- |
| `invalid_data`     | Request body failed schema validation       |
| `bad_request`      | Malformed request or unsupported operation  |
| `validation_error` | Field-level validation failure (Assets API) |

### 401 Unauthenticated / Upstream Credential Rejected

> **Picking between the three auth-adjacent errors:**
>
> - `unauthenticated` — the **caller** has not proven who they are: absent, malformed, or rejected
>   credentials. Re-authenticate and retry.
> - `unauthorized` — an **upstream server** (e.g. a git host) rejected _this server's_ own
>   credential. The caller is authenticated; the problem is the server's token, not theirs. Do
>   **not** prompt the end-user to re-authenticate.
> - `forbidden` (403) — the caller is authenticated but not permitted to perform this action.

| Code              | Description                                                             |
| ----------------- | ----------------------------------------------------------------------- |
| `unauthenticated` | Caller has not proven who they are — missing or rejected credential     |
| `unauthorized`    | An upstream server rejected this server's credential (not the caller's) |

### 403 Forbidden

| Code                         | Description                                                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `forbidden`                  | Authenticated but not permitted to perform this action                                                                                  |
| `dir_instead_of_file`        | Expected a file at the given key but found a directory                                                                                  |
| `file_instead_of_dir`        | Expected a directory at the given key but found a file                                                                                  |
| `permission_denied`          | Access to the backing storage medium was refused or revoked — user must grant access again                                              |
| `permission_prompt_required` | Access must be re-requested (e.g. a file handle whose permission lapsed to `'prompt'`) — recoverable by prompting inside a user gesture |

### 404 Not Found

| Code        | Description             |
| ----------- | ----------------------- |
| `not_found` | Resource does not exist |

### 409 Conflict

| Code                   | Description                                                          |
| ---------------------- | -------------------------------------------------------------------- |
| `version_mismatch`     | The record was modified by another writer since last read            |
| `entry_already_exists` | An object or folder already exists at the requested key              |
| `conflict`             | Generic conflict — the operation cannot proceed in the current state |

### 410 Gone

| Code           | Description                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------- |
| `stale_handle` | A stored handle no longer connects to its underlying resource — the target was deleted or moved; select it again |

### 413 Payload Too Large

| Code             | Description                      |
| ---------------- | -------------------------------- |
| `file_too_large` | Uploaded file exceeds size limit |

### 415 Unsupported Media Type

| Code                    | Description                                              |
| ----------------------- | -------------------------------------------------------- |
| `unsupported_file_type` | File type is not permitted by the backend's allow-list   |
| `dangerous_file_type`   | File type is blocked because it is potentially dangerous |

### 422 Unprocessable Entity

| Code               | Description                                                      |
| ------------------ | ---------------------------------------------------------------- |
| `corrupted_file`   | File content could not be parsed or is structurally invalid      |
| `embedded_content` | File contains disallowed embedded content (e.g. macros, scripts) |

### 423 Locked

| Code            | Description                                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lock_conflict` | A document is held by a lock the caller does not own — retry after the lock is released (see ADR-007; deliberately 423 not 409 so clients branch on status alone) |

### 429 Too Many Requests

| Code                | Description                       |
| ------------------- | --------------------------------- |
| `too_many_requests` | Rate limit exceeded — retry later |

### 500 Internal Server Error

| Code                 | Description                                                     |
| -------------------- | --------------------------------------------------------------- |
| `internal_error`     | Unexpected server error                                         |
| `illegal_state`      | The server reached an impossible internal state                 |
| `unknown_error`      | Error of unrecognised origin                                    |
| `authorizer_failure` | API Gateway authorizer failed — infrastructure-level auth error |

### 501 Not Implemented

| Code              | Description                                    |
| ----------------- | ---------------------------------------------- |
| `not_implemented` | The operation is not supported by this backend |

### 503 / 504 Upstream Errors

| HTTP | Code                  | Description                                     |
| ---- | --------------------- | ----------------------------------------------- |
| 503  | `service_unavailable` | A required upstream service is temporarily down |
| 504  | `gateway_timeout`     | An upstream request timed out                   |

### 507 Insufficient Storage

| Code             | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `quota_exceeded` | The backing storage medium is full or over its allotted quota — write was refused |
