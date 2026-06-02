import { serve } from '@hono/node-server';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

import { signToken, validateCredentials, verifyToken } from './auth.ts';
import { laika } from './laika.ts';

const app = new Hono();

// ── Auth middleware ────────────────────────────────────────────────────────────

async function requireAuth(c: Parameters<Parameters<typeof app.use>[1]>[0], next: () => Promise<void>) {
  const token = getCookie(c, 'session');
  if (!token) return c.redirect('/login');
  try {
    await verifyToken(token);
  } catch {
    deleteCookie(c, 'session');
    return c.redirect('/login');
  }
  return next();
}

// ── Login ──────────────────────────────────────────────────────────────────────

app.get('/login', c => {
  const error = c.req.query('error');
  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Login · LaikaCMS</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 360px; margin: 80px auto; padding: 0 1rem; }
    label { display: block; margin-bottom: .25rem; font-size: .875rem; font-weight: 500; }
    input { width: 100%; box-sizing: border-box; padding: .5rem .75rem; border: 1px solid #d1d5db; border-radius: .375rem; margin-bottom: 1rem; }
    button { width: 100%; padding: .5rem; background: #2563eb; color: #fff; border: none; border-radius: .375rem; cursor: pointer; }
    .error { color: #dc2626; margin-bottom: 1rem; font-size: .875rem; }
  </style>
</head>
<body>
  <h1>CMS Login</h1>
  ${error ? '<p class="error">Invalid username or password.</p>' : ''}
  <form method="POST" action="/login">
    <label for="username">Username</label>
    <input id="username" name="username" type="text" autocomplete="username" required />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required />
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`);
});

app.post('/login', async c => {
  const body = await c.req.parseBody();
  const username = String(body['username'] ?? '');
  const password = String(body['password'] ?? '');

  const user = validateCredentials(username, password);
  if (!user) return c.redirect('/login?error=1');

  const token = await signToken(user);
  setCookie(c, 'session', token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 8, // 8 hours, matching the JWT expiry
  });
  return c.redirect('/admin');
});

app.get('/logout', c => {
  deleteCookie(c, 'session');
  return c.redirect('/login');
});

// ── Admin (JWT injected server-side) ──────────────────────────────────────────

app.get('/admin', requireAuth, async c => {
  // The session cookie holds a signed JWT. We inject it directly into the
  // admin shell so the Decap frontend authenticates as the logged-in user
  // without a separate OAuth round-trip.
  //
  // This is the `devToken` option added to decapAdminHtml() — previously
  // the function always loaded DEFAULT_DEV_TOKEN from CDN, which made it
  // impossible to use real auth without writing your own admin HTML.
  const token = getCookie(c, 'session')!;
  return c.html(decapAdminHtml({
    devToken: token,
    title: 'Admin · My Blog',
  }));
});

// ── Laika API ──────────────────────────────────────────────────────────────────

// Requests here carry `Authorization: Bearer <jwt>` — validated by the
// `authenticateAccessToken` callback in laika.ts.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// ── Public blog ───────────────────────────────────────────────────────────────

app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      folder: 'posts',
      depth: 1,
      pagination: { page: 1, perPage: 100 },
      type: 'published',
    }),
  );

  type Summary = { key: string; type: string; updatedAt?: string };
  const posts = (items as Summary[])
    .filter(r => r.type === 'published-summary')
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }));

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  <a href="/admin">CMS Admin</a>
  <hr />
  ${posts.length === 0
    ? '<p>No posts yet. <a href="/admin">Write one.</a></p>'
    : `<ul>${posts.map(p =>
        `<li><a href="/posts/${p.slug}">${p.slug}</a>${p.updatedAt ? ` · <time>${new Date(p.updatedAt).toLocaleDateString()}</time>` : ''}</li>`
      ).join('')}</ul>`
  }
</body>
</html>`);
});

app.get('/posts/:slug', async c => {
  const { slug } = c.req.param();
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = doc.content as { title?: string; body?: string };
    return c.html(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><title>${content.title ?? slug}</title></head>
<body>
  <a href="/">← Back</a>
  <h1>${content.title ?? slug}</h1>
  <div>${content.body ?? ''}</div>
</body>
</html>`);
  } catch (err) {
    if (err instanceof NotFoundError) return c.notFound();
    throw err;
  }
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const port = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port }, () => {
  console.log(`Listening on http://localhost:${port}`);
  console.log(`  Blog:  http://localhost:${port}/`);
  console.log(`  Login: http://localhost:${port}/login`);
  console.log(`  Admin: http://localhost:${port}/admin  (requires login)`);
  console.log(`  User:  admin / ${process.env.ADMIN_PASSWORD ?? 'password'}`);
});
