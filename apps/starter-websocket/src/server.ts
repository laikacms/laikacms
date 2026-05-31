import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { collectStream } from 'laikacms/compat';

import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS WebSocket starter' });

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });

const POLL_MS = 2_000;
type Snapshot = Map<string, string>;

async function snapshot(): Promise<Snapshot> {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 500 },
      type: 'published',
    }),
  );
  const map: Snapshot = new Map();
  for (const item of items) {
    if (item.type === 'published') {
      const key = (item as { key: string }).key;
      const updatedAt = (item as { updatedAt?: string }).updatedAt ?? '';
      map.set(key, updatedAt);
    }
  }
  return map;
}

// Shared subscriber set — every connected WebSocket gets every event.
type Sender = { send: (data: string) => void };
const subscribers = new Set<Sender>();
let prev: Snapshot = new Map();

void (async () => {
  prev = await snapshot();
})();

setInterval(async () => {
  if (subscribers.size === 0) return;
  try {
    const next = await snapshot();
    const events: Array<Record<string, unknown>> = [];
    for (const [key, ts] of next) {
      if (!prev.has(key)) events.push({ type: 'added', key, updatedAt: ts });
      else if (prev.get(key) !== ts) events.push({ type: 'changed', key, updatedAt: ts });
    }
    for (const key of prev.keys()) {
      if (!next.has(key)) events.push({ type: 'removed', key });
    }
    prev = next;
    for (const event of events) {
      const payload = JSON.stringify(event);
      for (const sub of subscribers) sub.send(payload);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('snapshot error:', err);
  }
}, POLL_MS);

app.get('/', c =>
  c.html(`<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>LaikaCMS WebSocket demo</title></head>
  <body style="font-family: system-ui; max-width: 720px; margin: 0 auto; padding: 2rem 1rem;">
    <h1>LaikaCMS WebSocket event log</h1>
    <p>Connected to <code>ws://${process.env.HOST ?? 'localhost'}:${PORT}/ws</code>. Edit posts at
      <a href="/admin">/admin</a>. The WS is bidirectional — try the input below.</p>
    <pre id="log" style="background: #f5f5f5; padding: 1rem; height: 50vh; overflow: auto;"></pre>
    <form id="send" style="display: flex; gap: 0.5rem;">
      <input id="msg" style="flex: 1; padding: 0.5rem;" placeholder="ping the server" />
      <button>send</button>
    </form>
    <script>
      const log = document.getElementById('log');
      const ws = new WebSocket(\`ws://\${location.host}/ws\`);
      ws.onopen = () => log.textContent += 'connected\\n';
      ws.onmessage = e => { log.textContent += e.data + '\\n'; log.scrollTop = log.scrollHeight; };
      ws.onclose = () => log.textContent += 'disconnected\\n';
      document.getElementById('send').onsubmit = e => {
        e.preventDefault();
        ws.send(document.getElementById('msg').value);
        document.getElementById('msg').value = '';
      };
    </script>
  </body>
</html>`));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.get(
  '/ws',
  upgradeWebSocket(_c => ({
    onOpen(_evt, ws) {
      const sender: Sender = { send: data => ws.send(data) };
      subscribers.add(sender);
      ws.send(JSON.stringify({ type: 'hello', subscribers: subscribers.size }));
      // Stash the sender on the socket so we can remove it on close. The
      // raw WebSocket from @hono/node-ws lets us attach arbitrary props.
      (ws as unknown as { _sender: Sender })._sender = sender;
    },
    onMessage(evt, ws) {
      // Echo any client message — demonstrates that the channel is
      // bidirectional (unlike SSE).
      ws.send(JSON.stringify({ type: 'echo', received: String(evt.data) }));
    },
    onClose(_evt, ws) {
      const sender = (ws as unknown as { _sender?: Sender })._sender;
      if (sender) subscribers.delete(sender);
    },
  })),
);

const server = serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS WebSocket backend listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
