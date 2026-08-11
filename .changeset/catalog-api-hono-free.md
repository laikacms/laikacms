---
"laikacms": major
---

`laikacms/catalog-api` no longer depends on Hono, and `laikacms` core is now framework-free.

`catalog-api` was the last file in the package that imported a web framework: the other three
JSON:API handlers (documents, assets, storage) were already plain fetch handlers. It now matches
them. `buildJsonApi` returns `{ fetch(request: Request): Promise<Response> }` instead of a Hono
`app`, so the only thing the handler assumes is the platform `Request`/`Response` pair.

`hono` and `@hono/node-server` are dropped from the package's peer dependencies. They were already
optional, so an install that does not use them is unaffected; `@laikacms/server` still depends on
Hono for its own router and is unchanged.

The wire behaviour is identical: same routes, same status codes, same JSON:API bodies, same
`Cache-Control: no-store` on every response, and the same DynamoDB-transport 503 special case. The
existing 53 catalog-api tests pass untouched, because they already drove the handler through
`api.fetch(new Request(...))`.

Two deliberate differences:

- An unmatched route now returns a JSON:API `404` error document instead of Hono's plain-text
  `404 Not Found`. The status and the `Cache-Control` header are unchanged.
- Responses keep `Content-Type: application/json` (what Hono's `c.json()` sent), rather than moving
  to `application/vnd.api+json` as the other three handlers use. Aligning them is a separate
  decision, not a side effect of dropping the framework.

Only callers that used the returned value as a Hono app (`.route()`, `.use()`, mounting it inside
another Hono instance) need to change: mount `handler.fetch` instead. Nothing in this repository
did.
