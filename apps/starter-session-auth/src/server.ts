/**
 * starter-session-auth — login page + session cookies + per-request JWT injection
 *
 * Auth flow:
 *   1. GET  /login        → login form
 *   2. POST /login        → verify password, issue JWT, set httpOnly session cookie
 *   3. GET  /admin        → middleware reads cookie, calls decapAdminHtml({ devToken: jwt })
 *                           so the Decap frontend auto-logs in with the current session token
 *   4. Decap sends        Authorization: Bearer <jwt>
 *   5. authenticateAccessToken verifies with jose.jwtVerify — no roundtrip to a session store
 *
 * Key pattern: decapAdminHtml() is called per-request so every admin page load gets a
 * fresh token injection. The function is cheap (pure string interpolation), so per-request
 * use is fine.
 *
 * Production swap-ins:
 *   - Replace plaintext password comparison with bcrypt/argon2
 *   - Store users in a database instead of USERS array
 *   - Use asymmetric keys (RS256/ES256) so multiple services can verify without sharing a secret
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import type { MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { jwtVerify, SignJWT } from 'jose';
import { collectStream, runTask } from 'laikacms/compat';
import { AuthenticationError } from 'laikacms/core';

// ── Users ─────────────────────────────────────────────────────────────────────
// In production: store hashed passwords in a database. Never hard-code real creds.

interface User {
  id: string;
  email: string;
  name: string;
  password: string;
}

const USERS: User[] = [
  {
    id: 'admin-1',
    email: process.env.ADMIN_EMAIL ?? 'admin@example.com',
    name: 'Admin',
    password: process.env.ADMIN_PASSWORD ?? 'change-me-in-production',
  },
];

// ── JWT ───────────────────────────────────────────────────────────────────────

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? 'dev-secret-change-in-production-use-32-plus-chars',
);

async function signToken(user: User): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(JWT_SECRET);
}

// ── LaikaCMS setup ────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(__dirname, '../content');
const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir,
  decapConfig,
  basePath: '/api/decap',
  auth: {
    mode: 'custom',

    // Called for every `Authorization: Bearer <token>` request from Decap.
    // The token is the JWT we embedded in the admin HTML via devToken.
    authenticateAccessToken: async (token: string) => {
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        const id = payload.sub;
        const email = payload['email'] as string | undefined;
        const name = payload['name'] as string | undefined;
        if (!id || !email) throw new Error('Missing claims');
        return { id, email, name: name ?? email };
      } catch {
        throw new AuthenticationError('Invalid or expired session token');
      }
    },
  },
});

// ── Auth middleware ───────────────────────────────────────────────────────────

const requireAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, 'session');
  if (!token) return c.redirect('/login');
  try {
    await jwtVerify(token, JWT_SECRET);
    return next();
  } catch {
    deleteCookie(c, 'session', { path: '/' });
    return c.redirect('/login');
  }
};

// ── Hono routes ───────────────────────────────────────────────────────────────

const app = new Hono();

// Decap JSON:API proxy — WHATWG-native, zero bridge.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Login page.
app.get('/login', c => {
  const error = c.req.query('error');
  return c.html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Sign in · My Blog</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{max-width:24rem;margin:8rem auto;padding:0 1rem;font-family:system-ui,sans-serif}
    h1{margin:0 0 2rem}
    label{display:block;margin-bottom:.25rem;font-size:.875rem;font-weight:500}
    input{width:100%;padding:.5rem .75rem;border:1px solid #d1d5db;border-radius:.375rem;margin-bottom:1rem;font-size:1rem}
    button{width:100%;padding:.625rem 1rem;background:#0f172a;color:#fff;border:none;border-radius:.375rem;cursor:pointer;font-size:1rem}
    .error{color:#dc2626;margin-bottom:1rem;font-size:.875rem}
  </style>
</head>
<body>
  <h1>Sign in</h1>
  ${error ? '<p class="error">Invalid email or password.</p>' : ''}
  <form method="POST" action="/login">
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required autocomplete="email" placeholder="admin@example.com">
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password">
    <button type="submit">Sign in</button>
  </form>
</body>
</html>`);
});

// Login form submission.
app.post('/login', async c => {
  const body = await c.req.parseBody() as Record<string, string>;
  const user = USERS.find(u => u.email === body['email'] && u.password === body['password']);
  if (!user) return c.redirect('/login?error=1');

  const token = await signToken(user);
  setCookie(c, 'session', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'Strict',
    maxAge: 3600,
    secure: process.env.NODE_ENV === 'production',
  });
  return c.redirect('/admin');
});

// Admin shell — per-request so the embedded devToken matches the live session JWT.
// decapAdminHtml() is pure string interpolation; calling it on each request is fine.
app.get('/admin', requireAuth, c => {
  const token = getCookie(c, 'session')!;
  const html = decapAdminHtml({
    decapConfig,
    title: 'Admin · Session Auth',
    devToken: token,
  });
  return c.html(html);
});

// Logout.
app.post('/logout', c => {
  deleteCookie(c, 'session', { path: '/' });
  return c.redirect('/login');
});

// Blog index.
app.get('/', async c => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  type Summary = { type: string, key: string, updatedAt?: string };
  const posts = (items as Summary[])
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => (b.updatedAt ?? b.key).localeCompare(a.updatedAt ?? a.key));

  return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title>
<style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
<nav><a href="/" style="font-weight:bold">My Blog</a> · <a href="/admin">CMS</a></nav>
<h1>My Blog</h1>
${
    posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">
${
        posts.map(p => {
          const slug = p.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
          return `<li><a href="/blog/${slug}">${slug}</a>${
            date ? ` <time style="color:#666">${date}</time>` : ''
          }</li>`;
        }).join('\n')
      }
</ul>`
  }
</body></html>`);
});

// Single post.
app.get('/blog/:slug', async c => {
  const slug = c.req.param('slug');
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    type Post = { title?: string, date?: string, description?: string, body?: string };
    const { title, date, description, body } = (doc.content ?? {}) as Post;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    return c.html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title>
<style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
<nav><a href="/" style="font-weight:bold">My Blog</a> · <a href="/admin">CMS</a></nav>
<article>
<h1>${title ?? slug}</h1>
${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
${description ? `<p><em>${esc(description)}</em></p>` : ''}
<pre style="white-space:pre-wrap;font-family:inherit">${esc(body ?? '')}</pre>
<p><a href="/">← Back</a></p>
</article>
</body></html>`);
  } catch {
    return c.html('<h1>404 – Not found</h1><p><a href="/">← Home</a></p>', 404);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);
serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Running on http://localhost:${PORT}`);
  console.log(`Login:  http://localhost:${PORT}/login`);
  console.log(`Admin:  http://localhost:${PORT}/admin`);
  console.log(`Email:    ${USERS[0].email}`);
  console.log(`Password: ${USERS[0].password}`);
});
