# `@laikacms/starter-hattip`

LaikaCMS on [**Hattip**](https://github.com/hattipjs/hattip) — write the handler once, deploy it to
any runtime by swapping a single adapter import. Demonstrates that the LaikaCMS web-standard `fetch`
handler is genuinely runtime-portable.

## Stack

- Hattip router + composer (universal `(context) => Response`)
- `@hattip/adapter-node` — the runtime adapter for local dev
- `laikacms` + `@laikacms/decap-integrations/embedded` (FileSystem)

## Run (Node)

```bash
pnpm install
pnpm --filter @laikacms/starter-hattip dev
```

Then:

- `curl http://localhost:3000/` — endpoint index
- `curl http://localhost:3000/posts` — list published posts
- Open `http://localhost:3000/admin` — Decap CMS admin

## Layout

```
apps/starter-hattip/
├── src/
│   ├── handler.ts            # ★ the universal (context) => Response
│   └── node-entry.ts         # @hattip/adapter-node wiring
├── content/posts/hello-world.md
└── tsconfig.json
```

`handler.ts` doesn't import anything Node-specific. `node-entry.ts` is the entire Node-specific
surface — six lines.

## Deploy to other runtimes

The same `handler.ts` plugs into every Hattip adapter. Pattern is always: install the adapter, write
a 5-line entry file.

| Target             | Adapter                              | Entry file (sketch)                                                                                |
| ------------------ | ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Node.js            | `@hattip/adapter-node`               | already shipped (`src/node-entry.ts`)                                                              |
| Bun                | `@hattip/adapter-bun`                | `export default { fetch: handler }`                                                                |
| Cloudflare Workers | `@hattip/adapter-cloudflare-workers` | `export default { fetch: adapter(handler) }` — replace storage with `createCustomLaika` + R2 first |
| AWS Lambda         | `@hattip/adapter-aws-lambda`         | `export const handler = adapter(yourHandler)`                                                      |
| Deno               | `@hattip/adapter-deno`               | `Deno.serve(adapter(handler))`                                                                     |
| Vercel Edge        | `@hattip/adapter-vercel-edge`        | `export default adapter(handler)`                                                                  |

For Workers/Lambda/edge runtimes you'll also want to swap the storage layer in `handler.ts`: change
`createEmbeddedLaika` (FileSystem) to `createWorkersLaika` (R2) or `createCustomLaika` (BYO). The
handler shape stays the same; just the storage construction changes.

## Why Hattip?

It's the "Express but web-standard" of the moment. Two reasons it's useful for a LaikaCMS starter:

1. **It proves the LaikaCMS fetch handler is genuinely portable.** The decision tree "Node or
   Workers or Lambda or…" comes after the handler is written, not before.
2. **It's a smaller surface than Hono.** Hono ships routing + JSX + middleware + adapters; Hattip is
   just the router + a thin context. When you only need "match path, call fetch" Hattip is minimal.

## Production hardening

Same checklist as the other starters. See [`docs/starters.md`](../../docs/starters.md) and
[`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
