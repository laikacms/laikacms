import { serve } from '@hono/node-server';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { decapConfig, laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3001);

const ADMIN_HTML = decapAdminHtml({
  title: 'Admin · LaikaCMS Hexo Starter',
  decapConfig,
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-hexo-blog admin server',
    routes: {
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API',
    },
    site: 'Hexo serves the public site on http://localhost:4000',
    docs: 'https://github.com/laikacms/laikacms',
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  console.log(`LaikaCMS admin  → http://localhost:${info.port}/admin`);
  console.log(`Hexo blog       → http://localhost:4000  (run: pnpm site:dev)`);
});
