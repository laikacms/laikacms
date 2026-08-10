---
"laikacms": major
"@laikacms/server": major
"@laikacms/vite-plugin": major
---

Require an explicit `authorize` policy on every JSON:API handler, and authorize the OpenAPI routes.

`authorize` was optional on `buildJsonApi` (storage, documents, catalog) and `buildAssetsApi`, and
omitting it meant "allow every caller everything". A security-critical default that you get by _not_
typing something is the wrong shape: the handler that reads, mutates, and deletes all your content
was one forgotten option away from being wide open, and nothing in the type system said so.
`@laikacms/server`'s `laikaApi` already required its policy — the four raw handlers were the
inconsistency.

`authorize` is now a **required** option on all four:

```typescript
const api = buildJsonApi({
  repo,
  authorize: async ({ action, request }) => {
    const user = await myAuth(request);
    if (!user) return new AuthenticationError('Missing token'); // → 401
    return user.isAdmin || action === 'readOpenApi'; // false → 403
  },
});
```

For a surface that is deliberately open — a dev server on loopback, a test harness, or a handler
already behind an authenticating proxy — state that explicitly with the new `allowAll` export from
`laikacms/json-api`:

```typescript
import { allowAll } from 'laikacms/json-api';

const api = buildJsonApi({ repo, authorize: allowAll });
```

Naming it rather than inlining `() => true` means every intentionally-open surface in a deployment
is one `rg 'authorize: allowAll'` away during an audit.

`GET /openapi.json` and `GET /openapi.yaml` are now authorized like every other action, via a new
`{ action: 'readOpenApi', format: 'json' | 'yaml' }` variant on each API's action union. Previously
they were served unconditionally, so a deny-all policy still handed out the full schema shape. A
policy that wants a public spec alongside a private API allows that one action:

```typescript
authorize: ({ action }) => action === 'readOpenApi' ? true : checkToken(...)
```

`AuthorizeDecision` and `resolveAuthorization` moved to `laikacms/json-api` and are now publicly
exported — `AuthorizeDecision` appears in the signature of every `*Authorize` callback type but was
previously unnameable by consumers.

`@laikacms/vite-plugin`'s local dev API and `@laikacms/server`'s inner handlers pass `allowAll` (the
vite dev server is loopback-guarded; `laikaApi` authenticates and applies its own `authorize` gate
before dispatching), so neither changes behaviour.
