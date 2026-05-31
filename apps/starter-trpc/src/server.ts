import { serve } from '@hono/node-server';
import { trpcServer } from '@hono/trpc-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { laika } from './laika.js';
import { appRouter } from './router.js';

const PORT = Number(process.env.PORT ?? 3000);
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS tRPC starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-trpc',
    runtime: `Node.js ${process.version}`,
    endpoints: {
      'GET /': 'this index',
      'ANY /trpc/*': 'tRPC endpoint (use @trpc/client with AppRouter type)',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
    note: 'Import AppRouter from src/router.ts on the client side for end-to-end type safety.',
  }));

// Mount tRPC. The @hono/trpc-server adapter handles the web-standard
// Request/Response conversion for us.
app.use('/trpc/*', trpcServer({ router: appRouter, endpoint: '/trpc' }));

// JSON:API + Decap admin stay mounted — same dual-surface pattern as the
// GraphQL starter.
app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS tRPC backend listening on http://localhost:${info.port}/trpc`);
});
