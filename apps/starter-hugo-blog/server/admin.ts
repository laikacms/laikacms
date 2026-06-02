import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ADMIN_PORT ?? 3001);

/**
 * Sidecar admin server.
 *
 * Hugo and this server share the same content directory. Decap writes posts
 * to content/posts/ via laika.fetch; Hugo's --watch picks up the changes and
 * regenerates the static site automatically.
 *
 * media_folder uses Hugo's static/ convention: files in static/ are served at
 * the root URL during `hugo server` and copied to public/ during `hugo build`.
 */
const laika = createEmbeddedLaika({
  contentDir: resolve(__dirname, '..', 'content'),
  decapConfig: minimalBlogConfig({ mediaFolder: 'static/uploads' }),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({ title: 'Admin · LaikaCMS Hugo starter' });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-hugo-blog admin server',
    routes: {
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API',
    },
    site: `Hugo serves the public site on http://localhost:1313`,
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS admin: http://localhost:${info.port}/admin`);
});
