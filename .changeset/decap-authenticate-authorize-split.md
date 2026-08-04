---
"@laikacms/decap": major
---

**Breaking:** `decap-api` now cleanly separates authentication from authorization.

- Authentication (`authenticateAccessToken` / `authenticateApiToken`) returns the principal's
  **identity** only. The `scope` field has been **removed** from the `User` interface.
- Authorization is now a single **required** `authorize(ctx)` callback on `DecapOptions`. It
  receives an `AuthorizeContext` —
  `{ user, request, method, domain, operation, collection?, itemId? }` — the principal plus the
  request pre-parsed into resource/operation so a policy can decide without re-parsing the URL.
  Return `true` to allow, `false` to reject with `403 Forbidden` before the request reaches any
  repository; a thrown callback fails closed. There is no implicit default — the policy must be
  stated.

Migration:

```ts
// Before — scope was carried on the User and enforced implicitly:
authenticateAccessToken: async t => ({ id, email, scope: readOnly ? 'read' : 'write' }),

// After — identity from authenticate*, policy in authorize:
authenticateAccessToken: async t => ({ id, email }),
authorize: ctx => (readOnly ? ctx.operation === 'read' : true),
```

Richer authorization ("roles", "admin", per-org rules) is expressed by augmenting the `User`
interface with your own identity fields and checking them inside `authorize` — the API no longer
imposes a fixed read/write vocabulary.
