import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS SSE starter' });

/**
 * Minimal change detector: poll the documents repo every POLL_MS and emit
 * `added` / `removed` / `changed` events when the published post set
 * differs from the previous snapshot. LaikaCMS doesn't have native pub/sub
 * yet (tracked in ADR-001); this is the cheapest pre-bus way to feed an
 * SSE channel.
 */
const POLL_MS = 2_000;
type PostSnapshot = { key: string, updatedAt?: string | null };

async function snapshot(): Promise<Map<string, string>> {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 500 },
      type: 'published',
    }),
  );
  const map = new Map<string, string>();
  for (const item of items) {
    if (item.type === 'published') {
      const key = (item as { key: string }).key;
      const updatedAt = (item as { updatedAt?: string }).updatedAt ?? '';
      map.set(key, updatedAt);
    }
  }
  return map;
}

const app = new Hono();

app.get('/', c =>
  c.html(`<!DOCTYPE html>
<html lang="en">
  <head><meta charset="utf-8" /><title>LaikaCMS SSE demo</title></head>
  <body style="font-family: system-ui; max-width: 720px; margin: 0 auto; padding: 2rem 1rem;">
    <h1>LaikaCMS SSE event log</h1>
    <p>Subscribed to <code>/events</code>. Edit posts via <a href="/admin">/admin</a> — changes
      stream here in real time.</p>
    <pre id="log" style="background: #f5f5f5; padding: 1rem; height: 60vh; overflow: auto;"></pre>
    <script>
      const log = document.getElementById('log');
      const es = new EventSource('/events');
      es.onmessage = e => {
        log.textContent += new Date().toLocaleTimeString() + '  ' + e.data + '\\n';
        log.scrollTop = log.scrollHeight;
      };
      es.onerror = () => { log.textContent += 'connection error\\n'; };
    </script>
  </body>
</html>`));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Public read endpoints kept for parity with the other starters.
app.get('/posts', async c => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return c.json({
    posts: items
      .filter(i => i.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  });
});

app.get('/posts/:slug', async c => {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ error: 'Not found' }, 404);
    throw err;
  }
});

// The SSE channel.
app.get('/events', c =>
  streamSSE(c, async stream => {
    let prev = await snapshot();
    await stream.writeSSE({
      event: 'snapshot',
      data: JSON.stringify({ count: prev.size }),
    });

    // streamSSE keeps the connection open until the client disconnects.
    while (!stream.aborted) {
      await stream.sleep(POLL_MS);
      try {
        const next = await snapshot();

        for (const [key, ts] of next) {
          if (!prev.has(key)) {
            await stream.writeSSE({ event: 'added', data: JSON.stringify({ key, updatedAt: ts }) });
          } else if (prev.get(key) !== ts) {
            await stream.writeSSE({
              event: 'changed',
              data: JSON.stringify({ key, updatedAt: ts }),
            });
          }
        }
        for (const key of prev.keys()) {
          if (!next.has(key)) {
            await stream.writeSSE({ event: 'removed', data: JSON.stringify({ key }) });
          }
        }
        prev = next;
      } catch (err) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ message: (err as Error).message }),
        });
      }
    }
  }));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS SSE backend listening on http://localhost:${info.port}`);
});
