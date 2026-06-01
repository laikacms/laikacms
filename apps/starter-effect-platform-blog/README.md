# starter-effect-platform-blog

A minimal blog using **`@effect/platform-node`** as the HTTP server layer and **LaikaCMS** for
content management.

## Why this starter is interesting

LaikaCMS's `laika.fetch` is a plain `(Request) => Promise<Response>` (WHATWG web standard). That
means it works inside any framework that can call a fetch-style handler — including Effect
Platform's own HTTP server via a two-line bridge:

```ts
// Inside any HttpRouter.add handler:
const webReq = yield * HttpServerRequest.toWeb(request); // Effect → WHATWG
const webRes = yield * Effect.promise(() => laika.fetch(webReq));
return HttpServerResponse.fromWeb(webRes); // WHATWG → Effect
```

Every other route is a typed Effect, so you get tracing, structured concurrency, and Effect's error
model for your blog logic _and_ the CMS layer.

## Stack

| Piece         | Package                                                  |
| ------------- | -------------------------------------------------------- |
| HTTP server   | `@effect/platform-node` (`NodeHttpServer`, `HttpRouter`) |
| Content & CMS | `laikacms` + `@laikacms/decap-integrations`              |
| Runtime       | Node.js 22                                               |

## Quick start

```bash
pnpm install
pnpm dev
```

Open **http://localhost:3000** for the blog and **http://localhost:3000/admin** for the CMS.

## Key files

| File            | Purpose                                                        |
| --------------- | -------------------------------------------------------------- |
| `src/laika.ts`  | `createEmbeddedLaika` singleton (FileSystem storage, dev auth) |
| `src/server.ts` | All four routes as Effect Layers, served by `NodeHttpServer`   |

## How the HTTP API routes map

| Route             | Handler                                               |
| ----------------- | ----------------------------------------------------- |
| `GET /`           | Lists posts via `laika.documents.listRecordSummaries` |
| `GET /blog/:slug` | Reads a post via `laika.documents.getDocument`        |
| `GET /admin`      | Serves Decap CMS shell from CDN (`decapAdminHtml()`)  |
| `* /api/decap/*`  | Proxied to `laika.fetch` via WHATWG bridge            |

## Effect Platform API notes (4.0.0-beta.66)

In Effect 4.x, the HTTP types live under **`effect/unstable/http/*`** (not `@effect/platform`):

```ts
import * as HttpRouter from 'effect/unstable/http/HttpRouter';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';
```

`@effect/platform-node` provides the Node.js server runtime:

```ts
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
```

`HttpRouter.add(method, path, handler)` returns a **`Layer`**, not an `Effect`. Compose multiple
route layers with `Layer.mergeAll` and pass them to `HttpRouter.serve(app)`.
