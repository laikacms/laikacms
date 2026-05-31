import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { z } from 'zod';

import { collectStream } from 'laikacms/compat';

import { laika } from './laika.js';
import { type Event, WebhookHub } from './webhooks.js';

const PORT = Number(process.env.PORT ?? 3000);
const POLL_MS = 2_000;

const hub = new WebhookHub();

let prev = new Map<string, string>(); // key → updatedAt

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
      map.set(key, (item as { updatedAt?: string }).updatedAt ?? '');
    }
  }
  return map;
}

void (async () => {
  prev = await snapshot();
})();

setInterval(async () => {
  try {
    const next = await snapshot();
    const events: Event[] = [];
    for (const [key, ts] of next) {
      if (!prev.has(key)) events.push({ type: 'post.added', key, updatedAt: ts });
      else if (prev.get(key) !== ts) events.push({ type: 'post.changed', key, updatedAt: ts });
    }
    for (const key of prev.keys()) {
      if (!next.has(key)) events.push({ type: 'post.removed', key });
    }
    prev = next;
    for (const event of events) await hub.dispatch(event);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('snapshot/dispatch error:', err);
  }
}, POLL_MS);

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Webhooks starter' });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-webhooks',
    endpoints: {
      'GET /': 'this index',
      'GET /subscriptions': 'list subscriptions',
      'POST /subscriptions': 'subscribe a URL (body: { url, events?: [] })',
      'DELETE /subscriptions/:id': 'unsubscribe',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

const subscribeSchema = z.object({
  url: z.string().url(),
  events: z.array(z.enum(['post.added', 'post.changed', 'post.removed'])).optional(),
});

app.get('/subscriptions', c => c.json({ subscriptions: hub.list() }));

app.post('/subscriptions', async c => {
  const body = subscribeSchema.parse(await c.req.json());
  const sub = hub.subscribe(body.url, body.events ?? []);
  return c.json({ subscription: sub }, 201);
});

app.delete('/subscriptions/:id', c => {
  const removed = hub.unsubscribe(c.req.param('id'));
  return c.json({ removed });
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Webhooks backend listening on http://localhost:${info.port}`);
});
