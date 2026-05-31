import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { laika } from './laika.js';
import { rpc } from './routes.js';

const PORT = Number(process.env.PORT ?? 3000);
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · LaikaCMS Hono RPC starter' });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-hono-rpc',
    runtime: `Node.js ${process.version}`,
    endpoints: {
      'GET /': 'this index',
      'GET /rpc/posts': 'list published posts',
      'GET /rpc/posts/:slug': 'single published post',
      'POST /rpc/posts': 'create draft (json: { slug, title, body })',
      'POST /rpc/posts/:slug/publish': 'publish a draft',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
  }));

// Mount the typed RPC router. The mounting CALL also accumulates the route
// types — so `typeof app` gets `/rpc/posts`, `/rpc/posts/:slug`, etc.
app.route('/rpc', rpc);

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Hono RPC backend listening on http://localhost:${info.port}/rpc`);
});

export type AppType = typeof app;
