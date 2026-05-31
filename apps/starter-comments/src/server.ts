import { serve } from '@hono/node-server';
import { zValidator } from '@hono/zod-validator';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { z } from 'zod';

import { createComment, deleteComment, listComments, setStatus } from './comments.js';
import { decapConfig, laika } from './laika.js';
import { createRateLimit } from './rate-limit.js';

const PORT = Number(process.env.PORT ?? 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-admin-token';

const ADMIN_HTML = decapAdminHtml({
  decapConfig,
  title: 'Admin · LaikaCMS Comments starter',
});

// 5 comments per IP per 5 minutes (1 token / 60s).
const limit = createRateLimit({ capacity: 5, refillPerSecond: 1 / 60 });

const app = new Hono();

app.get('/', c =>
  c.json({
    name: '@laikacms/starter-comments',
    endpoints: {
      'POST /comments': 'submit a new comment {postSlug, author, body}',
      'GET /comments/:postSlug': 'list APPROVED comments for a post',
      'GET /admin/comments?status=': 'admin: list comments (auth: Bearer ADMIN_TOKEN)',
      'POST /admin/comments/:id/approve': 'admin: approve',
      'POST /admin/comments/:id/reject': 'admin: reject',
      'DELETE /admin/comments/:id': 'admin: delete',
      'GET /admin': 'Decap CMS admin shell',
    },
  }));

app.get('/admin', c => c.html(ADMIN_HTML));
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

app.post(
  '/comments',
  zValidator(
    'json',
    z.object({
      postSlug: z.string().min(1).max(200),
      author: z.string().min(1).max(80),
      body: z.string().min(1).max(2000),
    }),
  ),
  async c => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? 'unknown';
    const verdict = limit.check(ip);
    if (!verdict.ok) {
      return c.json(
        { error: 'rate_limited', retryAfterSeconds: verdict.retryAfterSeconds },
        429,
        { 'Retry-After': String(verdict.retryAfterSeconds) },
      );
    }
    const { postSlug, author, body } = c.req.valid('json');
    const comment = await createComment({ postSlug, author, body });
    return c.json(
      { id: comment.id, status: comment.status, message: 'awaiting moderation' },
      202,
    );
  },
);

app.get('/comments/:postSlug', async c => {
  const postSlug = c.req.param('postSlug');
  const comments = await listComments({ postSlug, status: 'approved' });
  return c.json({
    postSlug,
    count: comments.length,
    comments: comments.map(({ id, author, body, createdAt }) => ({ id, author, body, createdAt })),
  });
});

const adminAuth = async (c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) => {
  const auth = c.req.header('authorization');
  if (auth !== `Bearer ${ADMIN_TOKEN}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  await next();
};

app.use('/admin/comments', adminAuth);
app.use('/admin/comments/*', adminAuth);

app.get('/admin/comments', async c => {
  const status = c.req.query('status') as 'pending' | 'approved' | 'rejected' | undefined;
  const comments = await listComments({ status });
  return c.json({ count: comments.length, comments });
});

app.post('/admin/comments/:id/approve', async c => {
  const updated = await setStatus(c.req.param('id'), 'approved');
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, comment: updated });
});

app.post('/admin/comments/:id/reject', async c => {
  const updated = await setStatus(c.req.param('id'), 'rejected');
  if (!updated) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true, comment: updated });
});

app.delete('/admin/comments/:id', async c => {
  const ok = await deleteComment(c.req.param('id'));
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

serve({ fetch: app.fetch, port: PORT }, info => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS comments backend listening on http://localhost:${info.port}`);
  // eslint-disable-next-line no-console
  console.log(
    `  admin queue:  curl -H "Authorization: Bearer ${ADMIN_TOKEN}" http://localhost:${info.port}/admin/comments?status=pending`,
  );
});
