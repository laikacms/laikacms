---
"laikacms": minor
---

The JSON:API proxy repositories (storage, documents, assets) now send all requests through an Effect
`HttpClient` via a shared `JsonApiHttpTransport`. Each repository accepts an optional `httpClient`
option so a composition root can share one connection-pooled client (e.g. built with the new
`httpClientFromFetch` helper in `laikacms/json-api` around an undici Agent) across all proxy
repositories for TCP/TLS session reuse. Defaults to a `globalThis.fetch`-backed client, resolved at
request time. Network failures in the storage proxy now surface as typed `InvalidData` errors
instead of defects.

Fixed: a `LaikaTask.make` / `LaikaStream.make` builder that died with a defect (a thrown
non-`LaikaError`) silently killed the forked builder fiber without terminating the queue, hanging
every consumer forever. Defects now propagate to the consumer as a rejected cause.
