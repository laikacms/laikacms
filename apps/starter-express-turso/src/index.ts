import { createServer } from 'node:http';

import { createCustomLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/custom';
import { LibSqlDataSource, LibSqlStorageRepository } from '@laikacms/libsql/storage-libsql';
import express from 'express';
import type { Request as ExpressReq, Response as ExpressRes } from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';
import { jsonSerializer } from 'laikacms/storage-serializers-json';
import { markdownSerializer } from 'laikacms/storage-serializers-markdown';
import { rawSerializer } from 'laikacms/storage-serializers-raw';
import { yamlSerializer } from 'laikacms/storage-serializers-yaml';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const dataSource = new LibSqlDataSource({
  url: requireEnv('LIBSQL_URL'),
  auth: { token: process.env['LIBSQL_AUTH_TOKEN'] },
});

const storage = new LibSqlStorageRepository({
  dataSource,
  tableName: process.env['LIBSQL_TABLE'] ?? 'laika_storage',
  serializerRegistry: {
    md: markdownSerializer,
    yaml: yamlSerializer,
    yml: yamlSerializer,
    json: jsonSerializer,
    raw: rawSerializer,
  },
  defaultFileExtension: 'md',
});

const decapConfig = minimalBlogConfig();

const laika = createCustomLaika({
  storage,
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

const ADMIN_HTML = decapAdminHtml({ decapConfig, title: 'Admin · Express + Turso Blog' });

const app = express();

/**
 * Bridge Express's IncomingMessage to a Web API Request for laika.fetch.
 *
 * Doc gap: laika.fetch expects a WHATWG Fetch Request, not Node's IncomingMessage.
 * Frameworks built on Web APIs (Hono, Remix, Astro, Nuxt/h3) need no adapter.
 * Express and plain http.Server must read the raw body stream and construct
 * a Request object manually.
 */
async function toLaikaRequest(req: ExpressReq): Promise<Request> {
  const host = req.headers.host ?? 'localhost';
  const url = new URL(req.originalUrl, `http://${host}`);

  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Uint8Array[] = [];
    for await (const chunk of req) chunks.push(new Uint8Array(chunk as Buffer));
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    if (total > 0) {
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      body = merged.buffer;
    }
  }

  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body,
  });
}

async function sendLaikaResponse(webRes: Response, res: ExpressRes): Promise<void> {
  res.status(webRes.status);
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
  });
  res.send(Buffer.from(await webRes.arrayBuffer()));
}

// Decap JSON:API proxy
app.all('/api/decap/*path', async (req, res, next) => {
  try {
    const webRes = await laika.fetch(await toLaikaRequest(req));
    await sendLaikaResponse(webRes, res);
  } catch (err) {
    next(err);
  }
});

// Admin UI — served inline; no esbuild step needed with decapAdminHtml().
app.get('/admin', (_req, res) => {
  res.type('html').send(ADMIN_HTML);
});

// Blog index
app.get('/', async (_req, res, next) => {
  try {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = records
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    const items = posts
      .map(post => {
        const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
        const title = (post as { content?: { title?: string } }).content?.title ?? slug;
        const date = post.updatedAt
          ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
          : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${title}</a>${date}</li>`;
      })
      .join('\n      ');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    res.send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog · Express + Turso</title></head>
<body>
  <h1>My Blog</h1>
  <p><small>Storage: LibSqlStorageRepository / Turso</small></p>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`);
  } catch (err) {
    next(err);
  }
});

// Individual post
app.get('/blog/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    res.send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
  } catch (err) {
    if (err instanceof NotFoundError) {
      res.status(404).send('Post not found');
      return;
    }
    throw err;
  }
});

const PORT = Number(process.env['PORT'] ?? 3000);
createServer(app).listen(PORT, () => {
  console.log(`Express + Turso blog running at http://localhost:${PORT}`);
  console.log(`  Blog:    http://localhost:${PORT}/`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
});
