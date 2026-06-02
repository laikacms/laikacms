import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { MeiliSearch } from 'meilisearch';

import { createMeiliIndexer, type PostDoc } from './indexer.js';
import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);
const MEILI_HOST = process.env.MEILI_HOST ?? 'http://localhost:7700';
const MEILI_KEY = process.env.MEILI_KEY ?? 'devkey';

const meili = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_KEY });

// Kick off the periodic indexer. Returns a stop function; we don't use it
// here but tests / shutdown handlers could.
await createMeiliIndexer(meili);

const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Meilisearch starter',
});

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-meilisearch',
    meiliHost: MEILI_HOST,
    endpoints: {
      'GET /': 'this index',
      'GET /search?q=...': 'full-text search across published posts',
      'GET /admin': 'Decap CMS admin shell',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
    note: 'Indexer polls every 5s and pushes to Meilisearch.',
  }));

app.get('/search', async c => {
  const q = c.req.query('q') ?? '';
  if (!q) return c.json({ hits: [], query: q });
  const results = await meili.index<PostDoc>('posts').search(q, {
    limit: 20,
    attributesToHighlight: ['title', 'body'],
  });
  return c.json({
    query: q,
    estimatedTotalHits: results.estimatedTotalHits,
    hits: results.hits,
  });
});

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Meilisearch backend listening on http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(`Meilisearch host: ${MEILI_HOST}`);
});
