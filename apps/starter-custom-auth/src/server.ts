/**
 * starter-custom-auth — demonstrates createEmbeddedLaika({ auth: { mode: 'custom' } })
 *
 * In this pattern:
 *   - Server: validates Bearer tokens via a user-supplied callback (no hardcoded dev token).
 *   - Admin HTML: decapAdminHtml({ devToken: apiKey }) injects the API key so the Decap
 *     frontend can authenticate without an OAuth dance.
 *
 * Swap `USERS` and `authenticateAccessToken` for your real auth layer:
 *   JWT:      const payload = await jose.jwtVerify(token, JWT_SECRET)
 *   Firebase: const decoded = await admin.auth().verifyIdToken(token)
 *   Auth0:    const decoded = await client.verifyAccessToken({ token })
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serve } from '@hono/node-server';
import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Hono } from 'hono';
import { collectStream, runTask } from 'laikacms/compat';
import { AuthenticationError } from 'laikacms/core';

// ── Users / API keys ──────────────────────────────────────────────────────────
// In production: store hashed keys in a database. Never hard-code real keys.

interface Editor {
  id: string;
  email: string;
  name: string;
  apiKey: string;
}

const EDITORS: Editor[] = [
  {
    id: 'editor-1',
    email: 'alice@example.com',
    name: 'Alice',
    apiKey: process.env.EDITOR_API_KEY ?? 'change-me-in-production',
  },
];

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

    // Called for every request that carries `Authorization: Bearer <token>`.
    // Throw AuthenticationError (or any error) to reject.
    authenticateAccessToken: async token => {
      const editor = EDITORS.find(e => e.apiKey === token);
      if (!editor) throw new AuthenticationError('Invalid API key');
      return { id: editor.id, email: editor.email, name: editor.name };
    },

    // Optional: called for `Authorization: ApiKey <key>` or `X-API-Key` header.
    // Useful for CI / scripts that don't carry a full Bearer token.
    authenticateApiToken: async apiKey => {
      const editor = EDITORS.find(e => e.apiKey === apiKey);
      if (!editor) throw new AuthenticationError('Invalid API key');
      return { id: editor.id, email: editor.email };
    },
  },
});

// Build the admin HTML with the API key injected as `dev_token`.
// This lets the Decap frontend authenticate without an OAuth dance —
// exactly like dev mode, but using your real key.
//
// For a full OAuth flow (PKCE): pass `devToken: false` and implement
// the OAuth endpoints yourself.
const adminHtml = decapAdminHtml({
  decapConfig,
  title: 'Admin · Custom Auth',
  devToken: EDITORS[0].apiKey,
});

// ── Hono routes ───────────────────────────────────────────────────────────────

const app = new Hono();

// Decap JSON:API proxy — WHATWG-native, zero bridge.
app.all('/api/decap/*', c => laika.fetch(c.req.raw));

// Admin shell — already contains the API key via devToken.
app.get('/admin', c => c.html(adminHtml));

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
  console.log(`Admin:  http://localhost:${PORT}/admin`);
  console.log(`API key in use: ${EDITORS[0].apiKey}`);
});
