import { APP_BASE_HREF } from '@angular/common';
import { CommonEngine } from '@angular/ssr/node';
import express from 'express';
import type { Request as ExpressReq, Response as ExpressRes } from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { collectStream, runTask } from 'laikacms/compat';
import { createEmbeddedLaika, decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import bootstrap from './src/main.server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Angular build outputs browser assets to dist/browser and the server bundle
// to dist/server. This file is compiled into dist/server/server.mjs, so
// dist/browser is one level up.
const serverDistFolder = __dirname;
const browserDistFolder = resolve(serverDistFolder, '../browser');
const indexHtml = join(serverDistFolder, 'index.server.html');

const blogCollections = [
  {
    name: 'posts',
    label: 'Blog Posts',
    folder: 'posts',
    create: true,
    slug: '{{slug}}',
    sortable_fields: ['title', 'date'],
    fields: [
      { label: 'Title', name: 'title', widget: 'string' },
      { label: 'Date', name: 'date', widget: 'datetime' },
      { label: 'Description', name: 'description', widget: 'string', required: false },
      { label: 'Body', name: 'body', widget: 'markdown' },
    ],
  },
] as const;

const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  auth: { mode: 'dev' },
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});

// Bridge an Express IncomingMessage to a WHATWG Request.
// laika.fetch expects the web-standard Fetch API; Express uses Node's
// IncomingMessage. This adapter is needed for any Express-based integration.
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
      for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
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

const app = express();
const commonEngine = new CommonEngine();

// --- Laika / Decap routes (must come before Angular catch-all) ---

// Proxy all Decap JSON:API requests to laika.
// Do NOT add express.json() before this handler — it would drain the body stream
// before laika.fetch reads it. The adapter above reads the raw body itself.
app.all('/api/decap/*path', async (req, res, next) => {
  try {
    const webRes = await laika.fetch(await toLaikaRequest(req));
    await sendLaikaResponse(webRes, res);
  } catch (err) {
    next(err);
  }
});

// --- JSON API for Angular's HttpClient ---

interface PostSummary {
  slug: string;
  title?: string;
  date?: string;
  description?: string;
  updatedAt?: string;
}

interface Post extends PostSummary {
  body?: string;
}

app.get('/api/posts', async (_req, res, next) => {
  try {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts: PostSummary[] = records
      .filter(r => r.type === 'published-summary')
      .map(r => ({
        slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.slug.localeCompare(a.slug);
      });

    res.json(posts);
  } catch (err) {
    next(err);
  }
});

app.get('/api/posts/:slug', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = doc.content as {
      title?: string;
      date?: string;
      description?: string;
      body?: string;
    };
    const post: Post = { slug, title, date, description, body };
    res.json(post);
  } catch {
    res.status(404).json({ error: 'Post not found' });
  }
});

// Decap admin shell — served by Express before Angular takes over.
// decapAdminHtml() returns a complete standalone HTML page with Decap from CDN
// and the laika backend pre-wired. Angular must not hydrate this route, which
// is why it's served as a plain Express response.
app.get('/admin', (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(
    decapAdminHtml({
      decapConfig: {
        backend: { name: 'laika', api_url: '/api/decap' },
        media_folder: 'public/uploads',
        public_folder: '/uploads',
        collections: blogCollections,
      },
    }),
  );
});

// --- Angular SSR ---

// Serve browser bundles (JS, CSS, images) from the Angular build output.
app.get(['*.*'], express.static(browserDistFolder, { maxAge: '1y' }));

// All other routes — render with Angular SSR.
// We inject SERVER_URL so Angular's HttpClient can construct absolute URLs
// for /api/posts and /api/posts/:slug during server-side rendering.
app.get('**', (req, res, next) => {
  const { protocol, originalUrl, baseUrl, headers } = req;
  const serverUrl = `${protocol}://${headers.host}`;

  commonEngine
    .render({
      bootstrap,
      documentFilePath: indexHtml,
      url: `${protocol}://${headers.host}${originalUrl}`,
      publicPath: browserDistFolder,
      providers: [
        { provide: APP_BASE_HREF, useValue: baseUrl },
        { provide: 'SERVER_URL', useValue: serverUrl },
      ],
    })
    .then(html => res.send(html))
    .catch(err => next(err));
});

const PORT = Number(process.env['PORT'] ?? 4000);
createServer(app).listen(PORT, () => {
  console.log(`Angular SSR + LaikaCMS running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin`);
});
