# `@laikacms/starter-websocket`

A **WebSocket** feed of LaikaCMS content changes via `@hono/node-ws`. Bidirectional complement to
`apps/starter-sse` — both surface the same content-change events; this one also accepts
client→server messages (echoed back for demonstration).

Use this starter for collaborative editing, presence/cursor sharing, or any pattern where the client
needs to push state to the server (chat, kanban, multiplayer demos).

## Stack

- Hono + `@hono/node-server`
- `@hono/node-ws` — exposes `upgradeWebSocket` / `injectWebSocket`
- `laikacms` + `@laikacms/decap-integrations/embedded`
- Change detection: 2-second polling (same as the SSE starter — both swap to native pub/sub when
  ADR-001 lands)

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-websocket dev
```

Then:

- `http://localhost:3000` — live event log + a "send message" input.
- `http://localhost:3000/admin` — Decap CMS admin. Edit a post → `changed` event arrives over the
  WebSocket within ~2 seconds.

## WebSocket vs SSE — which to pick

| Concern           | SSE (`starter-sse`)           | WebSocket (this)                              |
| ----------------- | ----------------------------- | --------------------------------------------- |
| Direction         | Server → client only          | Bidirectional                                 |
| Wire protocol     | HTTP/1.1 long-lived response  | Upgraded TCP connection                       |
| Reconnect         | Browser handles automatically | You write it (`onclose` → backoff)            |
| Proxies           | Mostly fine (it's plain HTTP) | Some proxies need explicit WS upgrade support |
| Load balancers    | Stateless                     | Sticky sessions needed for many libraries     |
| Server complexity | One `streamSSE(...)` call     | Subscriber set + lifecycle handlers           |
| Browser API       | `EventSource`                 | `WebSocket`                                   |

For one-way notifications, SSE is simpler. For collaboration (typing indicators, cursor sharing,
live multiplayer), WebSocket is the right shape.

## Production hardening

- Authenticate the WebSocket upgrade — `upgradeWebSocket` gives you the request context, check
  cookies/tokens there.
- Heartbeats every 25–30 seconds (`ping` frame) so reverse proxies don't drop idle connections.
- Bound `subscribers` size — refuse new connections past a limit instead of OOMing.
- Sticky session routing if you run multiple instances and want broadcasts to fan out across them
  (or add Redis pub/sub between instances — the broadcast pattern abstracts cleanly).

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
