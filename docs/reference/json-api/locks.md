# Locks API

The Locks API provides advisory entry locking for admin UIs. It sits on top of the Documents
repository's lock methods (ADR-007) and is mounted by `laikaApi` at the configured base path.

> **Advisory only.** A lock does not prevent writes. It signals to the editor UI that another
> session is editing this entry, so the client can warn before someone clobbers a concurrent edit.

## Capability gate

Every route first checks whether the underlying Documents repository supports locking. Backends that
do not implement locking return `501 Not Implemented` on all routes — the client should treat this
as "locking is unsupported" and stop sending lock requests rather than treat it as a routing error.

## Key encoding

Lock keys are typically document keys (`collection/slug`). When the key contains slashes, those
slashes **must be percent-encoded as `%2F`** in the URL path — a raw slash is interpreted as a path
separator, not part of the key.

| Key             | Correct URL              |
| --------------- | ------------------------ |
| `posts`         | `/locks/posts`           |
| `posts/my-post` | `/locks/posts%2Fmy-post` |

## Data shapes

**Lock** — the public projection, visible to any caller:

```json
{
  "key": "posts/my-post",
  "owner": { "id": "user-123", "name": "Alice" },
  "acquiredAt": "2026-08-22T10:00:00.000Z",
  "expiresAt": "2026-08-22T10:05:00.000Z"
}
```

**OwnedLock** — returned only to the caller that acquired or refreshed the lock; adds `token`:

```json
{
  "key": "posts/my-post",
  "owner": { "id": "user-123", "name": "Alice" },
  "acquiredAt": "2026-08-22T10:00:00.000Z",
  "expiresAt": "2026-08-22T10:05:00.000Z",
  "token": "<opaque-bearer-string>"
}
```

The `token` is an opaque bearer string. Keep it secret — whoever holds it can refresh or release the
lock. It is never returned by `GET` and is invalidated when someone force-acquires the lock.

## Endpoints

---

### GET /locks/:key

Returns the current lock on `key`, or `null` if the entry is not locked.

**Response 200**

```json
{ "data": Lock | null }
```

---

### POST /locks/:key

Acquire a lock on `key`. The owner identity is derived server-side from the authenticated principal
— a caller cannot take a lock as someone else.

**Request body** (all fields optional)

```json
{
  "ttlMs": 300000,
  "force": false
}
```

| Field   | Type    | Default | Description                                                  |
| ------- | ------- | ------- | ------------------------------------------------------------ |
| `ttlMs` | number  | 300000  | Lock lifetime in milliseconds (default 5 min).               |
| `force` | boolean | false   | Override an existing lock held by a different owner/session. |

**Response 200** — lock acquired

```json
{ "data": OwnedLock }
```

**Response 423** — lock held by another owner

```json
{
  "data": Lock | null,
  "errors": [{ "status": "423", "detail": "..." }]
}
```

`data` carries the current holder so the client can render an "is being edited by Alice" banner
without a follow-up `GET`.

---

### POST /locks/:key/refresh

Extend an existing lock the caller owns. Requires the bearer token from the original acquire or last
refresh.

**Request body**

```json
{
  "token": "<token>",
  "ttlMs": 300000
}
```

`token` is required. `ttlMs` is optional (same default as acquire).

**Response 200**

```json
{ "data": OwnedLock }
```

**Response 423** — lock was force-taken by another caller since the last acquire/refresh

```json
{
  "data": Lock | null,
  "errors": [{ "status": "423", "detail": "..." }]
}
```

---

### DELETE /locks/:key

Release the lock. Requires the bearer token.

**Request body**

```json
{ "token": "<token>" }
```

**Response 200**

```json
{ "meta": { "released": true } }
```

---

## Error responses

| Status | When                                                       |
| ------ | ---------------------------------------------------------- |
| 400    | Missing or malformed lock key; missing token on write ops. |
| 405    | Method not allowed.                                        |
| 423    | Lock conflict; body carries the current holder.            |
| 500    | Unexpected repository failure.                             |
| 501    | Backend does not support locking.                          |

See [Error Responses](./errors) for the shared error envelope format.

## Typical client flow

1. `POST /locks/{key}` on editor open → store the returned `token` in session state.
2. Poll `POST /locks/{key}/refresh` every ~4 min (before the 5 min TTL) to hold the lock.
3. `DELETE /locks/{key}` on editor close, passing the token.
4. On `423`: read `data.owner.name` from the response body and surface the warning banner — no extra
   `GET` needed.
5. On `501`: disable lock UI; the backend does not support locking.
