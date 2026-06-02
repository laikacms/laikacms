import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3001);

// Eleventy and the admin server share the same content directory. The admin
// writes (via Decap → laika.fetch), and Eleventy's --serve picks up changes.
const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  decapConfig: minimalBlogConfig(),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = readFileSync(resolve(__dirname, 'admin.html'), 'utf8');

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-eleventy-jamstack admin server',
    routes: {
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
    site: 'Eleventy serves the public site on http://localhost:3000',
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS admin listening on http://localhost:${info.port}/admin`);
});
