import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { createYoga } from 'graphql-yoga';
import { Hono } from 'hono';

import { laika } from './laika.js';
import { schema } from './schema.js';

const PORT = Number(process.env.PORT ?? 3000);
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS GraphQL starter',
});

const yoga = createYoga({ schema, graphqlEndpoint: '/graphql' });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-graphql',
    runtime: `Node.js ${process.version}`,
    endpoints: {
      'GET /': 'this index',
      'GET|POST /graphql': 'GraphQL endpoint (GraphiQL on GET in a browser)',
      'GET /admin': 'Decap CMS admin shell (JSON:API still works alongside GraphQL)',
      'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
    },
  }));

// GraphQL endpoint — graphql-yoga handles both POST (queries) and GET (GraphiQL playground).
app.all('/graphql', c => yoga.handle(c.req.raw, {}));

// Decap admin + JSON:API stay mounted alongside the GraphQL endpoint —
// they're not mutually exclusive. Editors use JSON:API; reads can use either.
app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS GraphQL backend listening on http://localhost:${info.port}/graphql`);
});
