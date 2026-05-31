import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { z } from 'zod';

import { laika } from './laika.js';
import { createSubscriberStore } from './subscribers.js';

const PORT = Number(process.env.PORT ?? 3000);
const store = createSubscriberStore();

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Email digest starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-email-digest',
    endpoints: {
      'GET /': 'this index',
      'POST /subscribe': 'subscribe an email (body: { email })',
      'GET /unsubscribe?token=…': 'unsubscribe via the link in the digest',
      'GET /subscribers': 'admin list',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
    sendCommand: 'pnpm --filter @laikacms/starter-email-digest send-digest  (wire to your cron of choice)',
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.post(
  '/subscribe',
  zValidator('json', z.object({ email: z.string().email() })),
  async c => {
    const { email } = c.req.valid('json');
    const sub = await store.add(email);
    return c.json({ subscribed: true, email: sub.email, subscribedAt: sub.subscribedAt }, 201);
  },
);

app.get('/unsubscribe', async c => {
  const token = c.req.query('token');
  if (!token) return c.text('Missing token', 400);
  const removed = await store.unsubscribeByToken(token);
  return c.html(`<!doctype html><html><body style="font-family: system-ui; padding: 2rem;">
    <h2>${removed ? 'Unsubscribed' : 'Unknown token'}</h2>
    <p>${removed ? "You won't receive any more digests." : 'This unsubscribe link is invalid or already used.'}</p>
  </body></html>`);
});

app.get('/subscribers', async c => {
  // In production lock this behind an admin token. The starter leaves it
  // open for inspection.
  const all = await store.list();
  return c.json({
    count: all.length,
    subscribers: all.map(s => ({
      email: s.email,
      subscribedAt: s.subscribedAt,
      lastDigestSentAt: s.lastDigestSentAt,
    })),
  });
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS email digest backend listening on http://localhost:${info.port}`);
});
