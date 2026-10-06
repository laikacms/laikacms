# `laikacms/assets/jsonapi-proxy`

A `AssetsRepository` implementation that forwards every call to a remote Laika
[Assets API](../../../../../docs/reference/json-api/assets.md) over HTTP. Use it when the real
repository runs on a server — a browser client, an edge function, or another service can then work
with that repository as if it were local. It only depends on `fetch`, so it runs on any runtime.

## Usage

```ts
import { AssetsJsonApiProxyRepository } from 'laikacms/assets/jsonapi-proxy';

const repo = new AssetsJsonApiProxyRepository({
  baseUrl: 'https://cms.example.com/api/assets',
  tokenPromise: async () => getAccessToken(),
});
```

## Options

| Option         | Type                    | Description                                                                                                     |
| -------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------- |
| `baseUrl`      | `string`                | Root URL of the remote Assets API.                                                                              |
| `authToken`    | `string` (optional)     | Static bearer token sent with every request.                                                                    |
| `tokenPromise` | `() => Promise<string>` | Called before each request to get a fresh bearer token. Use this instead of `authToken` for tokens that expire. |
| `httpClient`   | `HttpClient` (optional) | Shared HTTP client (see `httpClientFromFetch` in `laikacms/json-api`). Defaults to `globalThis.fetch`.          |

Recoverable warnings the server reports in a response's `meta.warnings` are re-emitted on the
returned task, so they are not lost at the network boundary.
