# JSON:API Proxy

The `*-jsonapi-proxy` repositories implement the repository contracts _by calling_ a remote LaikaCMS
[JSON:API](../reference/json-api/) — one proxy per protocol: `storage-jsonapi-proxy`,
`documents-jsonapi-proxy`, `assets-jsonapi-proxy`. A LaikaCMS server is therefore just another
backend, and where you draw the network boundary becomes a deployment decision
([Transports](../concepts/transports)).

## Wire it up

```ts
import { AssetsJsonApiProxyRepository } from 'laikacms/assets-jsonapi-proxy';
import { DocumentsJsonApiProxyRepository } from 'laikacms/documents-jsonapi-proxy';
import { StorageJsonApiProxyRepository } from 'laikacms/storage-jsonapi-proxy';

const baseUrl = 'https://api.example.com/api';
const storage = new StorageJsonApiProxyRepository({ baseUrl });
const documents = new DocumentsJsonApiProxyRepository({ baseUrl });
const assets = new AssetsJsonApiProxyRepository({ baseUrl });
```

This is also what [`laika local serve`](../cli/serve) pairs with: run a filesystem-backed JSON:API
locally and point proxies (or an edge dev runtime with no filesystem) at it.

## Connection reuse and middleware

Every proxy sends requests through an Effect `HttpClient` owned by a shared `JsonApiHttpTransport`
(`laikacms/json-api`). Each constructor accepts an optional `httpClient`; when omitted, a
process-wide default backed by `globalThis.fetch` is used, which already reuses connections on Node
≥ 18 (undici) and on Cloudflare Workers.

To tune TCP/TLS session reuse on Node, build one client at the composition root and share it:

```ts
import { httpClientFromFetch } from 'laikacms/json-api';
import { Agent, fetch as undiciFetch } from 'undici';

const dispatcher = new Agent({ keepAliveTimeout: 30_000, connections: 128 });
const httpClient = httpClientFromFetch(
  (input, init) => undiciFetch(input, { ...init, dispatcher }),
);

const storage = new StorageJsonApiProxyRepository({ baseUrl, httpClient });
const documents = new DocumentsJsonApiProxyRepository({ baseUrl, httpClient });
const assets = new AssetsJsonApiProxyRepository({ baseUrl, httpClient });
```

Any `HttpClient.HttpClient` works — including `@effect/platform-node`'s `NodeHttpClient` layers — so
retry, tracing, and rate-limiting middleware (`HttpClient.retryTransient`,
`HttpClient.withRateLimiter`, …) compose onto the client without touching the repositories.

## Capability notes

- Capabilities are the remote server's capabilities — the proxy forwards `getCapabilities()`.
- Auth is whatever the remote API requires; pass credentials the same way any other HTTP client
  would.
