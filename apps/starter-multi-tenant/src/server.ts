import { serve } from '@hono/node-server';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { getTenantLaika, tenantFromBearer } from './tenants.js';

const PORT = Number(process.env.PORT ?? 3000);
const BASE_PATH = '/api/decap';
const decapConfig = minimalBlogConfig();
const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Multi-tenant starter',
});

type Variables = { tenant: string | null };
const app = new Hono<{ Variables: Variables }>();

// Tenant-resolution middleware. The result lands on c.set('tenant', ...).
app.use('*', async (c, next) => {
  // Prefer Authorization header; fall back to ?tenant=… for browser admin UI.
  let tenant = tenantFromBearer(c.req.header('authorization') ?? null);
  if (!tenant) {
    const q = c.req.query('tenant');
    if (q === 'acme' || q === 'widgetco') tenant = q;
  }
  c.set('tenant', tenant);
  await next();
});

import type { Context } from 'hono';
function requireTenant(c: Context<{ Variables: Variables }>): string | Response {
  const tenant = c.get('tenant');
  if (!tenant) {
    return c.json(
      {
        error: 'unauthenticated',
        hint: 'Add `Authorization: Bearer <acme-token|widgetco-token>` or `?tenant=acme|widgetco`.',
      },
      401,
    );
  }
  return tenant;
}

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-multi-tenant',
    tenants: ['acme', 'widgetco'],
    demoTokens: {
      acme: 'Authorization: Bearer acme-token',
      widgetco: 'Authorization: Bearer widgetco-token',
    },
    endpoints: {
      'GET /': 'this index',
      'GET /admin?tenant=…': 'Decap CMS admin for the chosen tenant',
      'ANY /api/decap/*': 'LaikaCMS JSON:API for the authenticated tenant',
      'GET /posts': 'tenant-scoped list of published posts',
      'GET /posts/:slug': 'tenant-scoped single post',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));

app.all('/api/decap/*', c => {
  const tenant = requireTenant(c);
  if (typeof tenant !== 'string') return tenant;
  return getTenantLaika(tenant, BASE_PATH).fetch(c.req.raw);
});

app.get('/posts', async c => {
  const tenant = requireTenant(c);
  if (typeof tenant !== 'string') return tenant;
  const laika = getTenantLaika(tenant, BASE_PATH);
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return c.json({
    tenant,
    posts: items
      .filter(i => i.type === 'published')
      .map(item => ({
        key: (item as { key: string }).key,
        content: (item as { content?: unknown }).content,
      })),
  });
});

app.get('/posts/:slug', async c => {
  const tenant = requireTenant(c);
  if (typeof tenant !== 'string') return tenant;
  const laika = getTenantLaika(tenant, BASE_PATH);
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${c.req.param('slug')}`));
    return c.json({ tenant, post: doc });
  } catch (err) {
    if (err instanceof NotFoundError) return c.json({ tenant, error: 'Not found' }, 404);
    throw err;
  }
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Multi-tenant backend listening on http://localhost:${info.port}`);
});
