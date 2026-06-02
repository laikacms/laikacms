/**
 * Express + Handlebars + remark Markdown rendering + LaikaCMS.
 *
 * Three things this starter shows that others don't:
 *
 *   1. Handlebars (via express-handlebars) — Mustache-compatible, logic-less
 *      templates with layouts and partials. No arbitrary JS in templates;
 *      helpers provide controlled logic. Very popular for Express apps.
 *
 *   2. express-handlebars layout system — a default layout wraps every view.
 *      The `{{{body}}}` triple-brace placeholder (unescaped) injects the
 *      rendered view into the layout. Individual views are just content
 *      fragments, not full HTML documents.
 *
 *   3. Triple-brace `{{{bodyHtml}}}` for pre-rendered HTML — Handlebars
 *      escapes `{{value}}` by default; `{{{value}}}` outputs raw HTML.
 *      Required when injecting remark-rendered Markdown into the template.
 */
import { Readable } from 'node:stream';

import express from 'express';
import { engine } from 'express-handlebars';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';
import { renderMarkdown } from './md.js';

const app = express();

// Configure express-handlebars.
// `defaultLayout: 'main'` wraps every view in views/layouts/main.hbs.
// `extname: '.hbs'` sets the template file extension.
app.engine('.hbs', engine({ defaultLayout: 'main', extname: '.hbs' }));
app.set('view engine', '.hbs');
app.set('views', './views');

app.use(express.static('public'));

// Decap JSON:API proxy — bridge Express IncomingMessage → WHATWG Request.
app.use(
  '/api/decap',
  express.raw({ type: '*/*', limit: '10mb' }),
  async (req, res) => {
    const host = req.headers.host ?? 'localhost';
    const proto = req.protocol ?? 'http';
    const url = `${proto}://${host}${req.originalUrl}`;
    const rawBody = req.body instanceof Buffer && req.body.byteLength > 0
      ? req.body
      : undefined;

    const webReq = new Request(url, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: rawBody,
      ...(rawBody ? { duplex: 'half' } : {}),
    } as RequestInit);

    const webRes = await laika.fetch(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((v, k) => {
      if (k.toLowerCase() !== 'transfer-encoding') res.setHeader(k, v);
    });

    if (webRes.body) {
      Readable.fromWeb(webRes.body as import('stream/web').ReadableStream).pipe(res);
    } else {
      res.end();
    }
  },
);

// Blog index.
app.get('/', async (_req, res) => {
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
    })
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      date: r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : null,
    }));

  res.render('index', { title: 'My Blog', posts });
});

// Blog post — renders Markdown body to safe HTML via remark pipeline.
app.get('/blog/:slug', async (req, res) => {
  const { slug } = req.params;

  let title: string;
  let bodyHtml: string;
  let date: string | null;

  try {
    const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = post.content as { title?: string, date?: string, body?: string };

    title = content.title ?? slug;
    date = content.date ? new Date(content.date).toLocaleDateString() : null;
    bodyHtml = await renderMarkdown(content.body ?? '');
  } catch {
    res.status(404).render('404', { title: 'Not found' });
    return;
  }

  res.render('post', { title, date, bodyHtml });
});

const port = Number(process.env['PORT'] ?? 3000);
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
