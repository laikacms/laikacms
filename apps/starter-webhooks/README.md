# `@laikacms/starter-webhooks`

**Outbound webhook subscriptions** with HMAC signing. Subscriber URLs receive a signed POST every
time LaikaCMS content changes. The common "notify downstream systems" integration pattern.

Use this when you want to:

- **Trigger downstream rebuilds.** Subscribe Vercel / Cloudflare / Netlify deploy hooks.
- **Send chat notifications.** Subscribe a Slack / Discord webhook URL.
- **Sync to external systems.** Subscribe a CRM, analytics pipeline, or search reindexer.

## Stack

- Hono + `@hono/node-server`
- Tiny in-memory `WebhookHub` (~80 LOC) — subscribe, unsubscribe, dispatch.
- Polling change detection (same pattern as the SSE / WebSocket / Meilisearch starters).
- `laikacms` + `@laikacms/decap-integrations/embedded`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-webhooks dev
```

Subscribe an endpoint (e.g. [webhook.site](https://webhook.site) for testing):

```bash
curl -X POST http://localhost:3000/subscriptions \
  -H "Content-Type: application/json" \
  -d '{"url":"https://webhook.site/your-unique-id"}'

# Response:
# { "subscription": {
#     "id": "a1b2…",
#     "url": "https://webhook.site/your-unique-id",
#     "secret": "deadbeef…",        ← save this to verify signatures
#     "events": [],                  ← empty = all events
#     "createdAt": "2026-05-31T…"
#   }
# }
```

Edit a post via `http://localhost:3000/admin` — within ~2 seconds your URL gets a POST.

## What subscribers receive

```http
POST /your-webhook-url HTTP/1.1
Content-Type: application/json
X-LaikaCMS-Signature: sha256=<hex>
X-LaikaCMS-Event: post.changed
X-LaikaCMS-Delivery: <unique-id>

{ "type": "post.changed", "key": "posts/hello-world", "updatedAt": "2026-05-31T…", "timestamp": "2026-05-31T…" }
```

### Verifying the signature (recipient side)

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifySignature(body: string, header: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const received = header.replace(/^sha256=/, '');
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
```

`body` is the raw request body **before any JSON parsing** — read it as a string and verify _then_
parse.

## Event types

| Event          | Fires when                                         |
| -------------- | -------------------------------------------------- |
| `post.added`   | A new published post appears in `posts/`           |
| `post.changed` | An existing published post's `updatedAt` changes   |
| `post.removed` | A previously published post is deleted/unpublished |

Subscribe to a subset by passing `events: ["post.added"]` in the subscribe body. Empty / unset means
all events.

## Production hardening

- **Persist subscriptions** (SQL, KV, GitHub backend) — the in-memory store loses everything on
  restart.
- **Move dispatch to a queue** (Cloudflare Queues, BullMQ, SQS) — downstream slowness shouldn't
  stall the polling loop.
- **Retry with exponential backoff.** Standard practice: retry 3–10 times with backoff; dead-letter
  after that.
- **Replay endpoint.** A `/subscriptions/:id/replay?since=…` route lets recipients catch up on
  missed events.
- **Auth on the management endpoints.** `POST /subscriptions` should require a Bearer token — this
  starter leaves it open for clarity.

## Why this matters

Webhook fan-out is the **opposite direction** from MCP (agents calling in) or REST/GraphQL/RPC
(clients calling in). When LaikaCMS gains native pub/sub (ADR-001) the polling loop here gets
swapped for a subscription; the dispatch + subscription store stay identical.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
