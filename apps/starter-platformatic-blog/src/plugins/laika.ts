import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contentDir = resolve(__dirname, '../../content');
const decapConfig = minimalBlogConfig();

const laika = createEmbeddedLaika({
  contentDir,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const adminHtml = decapAdminHtml({ decapConfig, title: 'Admin · Platformatic Blog' });

// ── Fastify ↔ Web Standards bridge ──────────────────────────────────────────
// Platformatic Service (and plain Fastify) wrap Node's IncomingMessage. We
// build a Web API Request from req.raw so laika.fetch() receives the real body
// stream — no JSON re-serialization needed.

function toWebRequest(req: FastifyRequest): Request {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)
    ?? ((req.raw.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http');
  const url = new URL(req.url, `${proto}://${req.headers.host ?? 'localhost'}`);

  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach(val => headers.append(k, val));
    else if (v !== undefined) headers.set(k, v);
  }

  const init: RequestInit & { duplex?: 'half' } = { method: req.method, headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req.raw) as unknown as ReadableStream;
    init.duplex = 'half';
  }
  return new Request(url, init);
}

async function sendWebResponse(reply: FastifyReply, res: Response): Promise<void> {
  reply.status(res.status);
  res.headers.forEach((v, k) => {
    if (k.toLowerCase() !== 'transfer-encoding') reply.header(k, v);
  });
  if (res.body) {
    reply.send(Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0]));
  } else {
    reply.send();
  }
}

// ── Plugin ───────────────────────────────────────────────────────────────────

async function laikaPlugin(app: FastifyInstance): Promise<void> {
  // Disable body parsing for the Decap proxy — we stream the raw body directly.
  app.addContentTypeParser('*', (_req, _payload, done) => {
    done(null, undefined);
  });

  // Decap JSON:API proxy — all verbs.
  app.all('/api/decap/*', async (req, reply) => {
    await sendWebResponse(reply, await laika.fetch(toWebRequest(req)));
  });

  // Decap CMS admin shell.
  app.get('/admin', async (_req, reply) => {
    reply.type('text/html').send(adminHtml);
  });

  // Blog index.
  app.get('/', async (_req, reply) => {
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

    const listItems = posts.map(p => {
      const slug = p.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const date = p.updatedAt ? new Date(p.updatedAt).toLocaleDateString() : '';
      return `<li><a href="/blog/${slug}">${slug}</a>${date ? ` <time style="color:#666">${date}</time>` : ''}</li>`;
    }).join('\n');

    reply.type('text/html').send(`<!doctype html>
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
        : `<ul style="list-style:none;padding:0">${listItems}</ul>`
    }
</body></html>`);
  });

  // Single post.
  app.get<{ Params: { slug: string } }>('/blog/:slug', async (req, reply) => {
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${req.params.slug}`));
      type Post = { title?: string, date?: string, description?: string, body?: string };
      const { title, date, description, body } = (doc.content ?? {}) as Post;
      const slug = req.params.slug;
      const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

      reply.type('text/html').send(`<!doctype html>
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
    } catch (err) {
      if (err instanceof NotFoundError) {
        reply.status(404).type('text/html').send('<h1>404 – Not found</h1><p><a href="/">← Home</a></p>');
        return;
      }
      throw err;
    }
  });
}

export default fp(laikaPlugin, { name: 'laika' });
