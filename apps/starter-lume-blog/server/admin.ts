/**
 * Admin sidecar server — serves the Decap CMS admin and LaikaCMS JSON:API.
 *
 * Run alongside the Lume dev server (`deno task dev` starts both):
 *   Lume   → http://localhost:3000  (blog)
 *   Admin  → http://localhost:3001/admin (Decap CMS editor)
 *
 * Architecture:
 *   - Lume reads content/posts/*.md at build time (file-system, no HTTP)
 *   - Decap CMS writes content/posts/*.md via this server's /api/decap/* proxy
 *   - laika.fetch handles all Decap API calls (auth, CRUD, config)
 *
 * Deno.serve() passes a WHATWG Request to the handler, which is exactly what
 * laika.fetch expects — no bridging needed.
 */
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from '../lib/decap-config.ts';
import { laika } from '../lib/laika.ts';

const PORT = Number(Deno.env.get('ADMIN_PORT') ?? 3001);

const ADMIN_HTML = decapAdminHtml({
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'content/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});

Deno.serve({ port: PORT }, async (req: Request) => {
  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/decap')) {
    return laika.fetch(req);
  }

  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return new Response(ADMIN_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (url.pathname === '/') {
    return Response.json({
      name: '@laikacms/starter-lume-blog admin server',
      routes: {
        'GET /admin': 'Decap CMS admin shell',
        'ANY /api/decap/*': 'LaikaCMS JSON:API',
      },
      site: `Lume serves the public blog on http://localhost:3000`,
    });
  }

  return new Response('Not Found', { status: 404 });
});

console.log(`LaikaCMS admin: http://localhost:${PORT}/admin`);
console.log(`Lume blog:      http://localhost:3000`);
