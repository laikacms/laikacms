# `laika local serve`

Start the local-file JSON:API storage server: a [FileSystem-backed](../backends/fs)
[Storage JSON:API](../reference/json-api/storage) over any directory. Use it when your app's runtime
can't touch the local filesystem — most notably Cloudflare Workers dev (`wrangler dev` / miniflare),
which pairs this server with the [JSON:API proxy repository](../backends/jsonapi-proxy) — or
whenever a quick real API over a folder is useful.

```sh
laika local serve                     # serve the cwd on http://127.0.0.1:3030
laika local serve -r ./content -p 4000
laika local serve --auth-token dev-secret
```

## Flags

| Flag                  | Alias | Default     | Description                                              |
| --------------------- | ----- | ----------- | -------------------------------------------------------- |
| `--root`              | `-r`  | cwd         | Root directory served by the storage repo                |
| `--port`              | `-p`  | `3030`      | Listen port                                              |
| `--host`              | `-H`  | `127.0.0.1` | Listen host                                              |
| `--default-extension` | —     | `md`        | Default file extension for new objects                   |
| `--auth-token`        | —     | (none)      | Require `Authorization: Bearer <token>` on every request |

> Without `--auth-token` the server is unauthenticated — it binds to `127.0.0.1` by default for
> exactly that reason. Set a token before binding to anything reachable.

## Guides

- [Quickstart: Cloudflare Workers](../getting-started/cloudflare-workers) — the miniflare pairing
- [JSON:API proxy backend](../backends/jsonapi-proxy) — pointing a repository at this server
