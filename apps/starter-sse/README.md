# `@laikacms/starter-sse`

A **Server-Sent Events** feed of LaikaCMS content changes. The page at `/` listens to `/events`;
edits made via Decap show up as `added` / `changed` / `removed` events within ~2 seconds.
Demonstrates Hono's `streamSSE` helper and the web-standard streaming `Response` body.

Use this starter as the starting point for any "push-based" UI: live blog feeds, real-time preview
during editing, "new content" toast notifications, dashboards.

## Stack

- Hono + `@hono/node-server`
- `hono/streaming.streamSSE` — wraps a `WritableStream` for SSE
- `laikacms` + `@laikacms/decap-integrations/embedded`
- Change detection: 2-second polling on top of `laika.documents.listRecords`

## Run

```bash
pnpm install
pnpm --filter @laikacms/starter-sse dev
```

Then:

- Open `http://localhost:3000` — the event log page (subscribes to `/events`).
- Open `http://localhost:3000/admin` — Decap CMS admin. Edit a post.
- The log on the first page shows a `changed` event within ~2 seconds.

## How it works

`server.ts` keeps an in-memory `Map<key, updatedAt>` snapshot of published posts. Every `POLL_MS`
(default 2000), it takes a new snapshot and diffs against the previous one. Any added, removed, or
changed keys produce SSE events.

```ts
app.get('/events', c =>
  streamSSE(c, async stream => {
    let prev = await snapshot();
    while (!stream.aborted) {
      await stream.sleep(POLL_MS);
      const next = await snapshot();
      // diff prev vs next, emit added/changed/removed events
      prev = next;
    }
  }));
```

## Polling vs native pub/sub

LaikaCMS doesn't yet have native pub/sub on the storage layer. ADR-001 in the repo proposes a real
subscription channel — once that lands, this starter swaps the polling loop for a real subscription
with no API change to the SSE channel. The wire format (`event: added/changed/removed`, JSON
payload) is what clients depend on; the source of those events is an implementation detail.

## Production hardening

- Tune `POLL_MS` to taste — high values reduce load but increase latency.
- Add `event: ping` heartbeats every ~25 seconds so reverse proxies don't drop idle connections.
- Use `Last-Event-ID` + cursor-based pagination if clients reconnect and need to catch up on missed
  events.
- Authenticate `/events` — anonymous read is fine for public content, but draft/admin events should
  sit behind a session check.

## See also

- `apps/starter-graphql` — graphql-yoga supports SSE-based subscriptions out of the box; same
  underlying pattern.
- `apps/starter-trpc` — tRPC has `useSubscription` for the typed-RPC equivalent.

See [`docs/starters.md`](../../docs/starters.md) and [`../../LLM-GUIDE.md`](../../LLM-GUIDE.md).
