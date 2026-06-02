/**
 * Electron main process — spins up a local Express + LaikaCMS HTTP server,
 * then opens a BrowserWindow pointing at it.
 *
 * Desktop CMS pattern:
 *   - HTTP server binds to 127.0.0.1 on a random port (never exposed on the
 *     network).
 *   - BrowserWindow loads http://127.0.0.1:<port>/ — same-origin as the
 *     Decap admin, so cookies and fetch() work without CORS headers.
 *   - Content lives in app.getPath('userData'), the OS-appropriate persistent
 *     location (~/.config/app-name on Linux, ~/Library/... on macOS,
 *     %APPDATA%\app-name on Windows).
 *
 * Doc gap surfaced: createEmbeddedLaika must be called INSIDE app.whenReady()
 * because app.getPath('userData') returns a path with a blank app name on
 * Windows and macOS until the app is fully initialised. Top-level calls
 * produce paths like "/Users/user/Library/Application Support//content".
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';

import { app, BrowserWindow, shell } from 'electron';
import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from './lib/decap-config.js';

interface PostSummary {
  type: string;
  key: string;
  updatedAt?: string;
}

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

app.setName('LaikaCMS Blog');

app.on('window-all-closed', () => app.quit());

app.whenReady().then(() => {
  // app.getPath() is only reliable after the app is ready.
  const contentDir = join(app.getPath('userData'), 'content');

  const laika = createEmbeddedLaika({
    contentDir,
    basePath: '/api/decap',
    auth: { mode: 'dev' },
    decapConfig: {
      backend: { name: 'laika', api_url: '/api/decap' },
      media_folder: 'uploads',
      public_folder: '/uploads',
      collections: blogCollections,
    },
  });

  const expressApp = express();

  // Serve static assets (admin HTML + bundle.js) from public/
  expressApp.use(express.static(join(process.cwd(), 'public')));

  // --- Decap JSON:API proxy ---------------------------------------------------
  // Express req/res are Node.js streams, not Web API Request/Response.
  // We manually drain the body then construct a WHATWG Request for laika.fetch.
  expressApp.all('/api/decap/*path', async (req, res) => {
    const host = req.headers['host'] ?? '127.0.0.1';
    const url = new URL(req.originalUrl ?? req.url, `http://${host}`);
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const body = Buffer.concat(chunks);
    const webReq = new Request(url.toString(), {
      method: req.method,
      headers: req.headers as Record<string, string>,
      ...(body.byteLength > 0 && req.method !== 'GET' && req.method !== 'HEAD'
        ? { body, duplex: 'half' }
        : {}),
    } as RequestInit);
    const webRes = await laika.fetch(webReq);
    res.status(webRes.status);
    webRes.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
    });
    res.end(Buffer.from(await webRes.arrayBuffer()));
  });

  // --- Blog index -----------------------------------------------------------
  expressApp.get('/', async (_req, res) => {
    const { items } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = (items as PostSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    const listHtml = posts.length === 0
      ? `<p style="color:#666">No posts yet — click <strong>Open CMS</strong> above to write your first post.</p>`
      : `<ul style="list-style:none;padding:0">${
        posts.map(post => {
          const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = post.updatedAt
            ? ` <time style="color:#999;font-size:.85em">${new Date(post.updatedAt).toLocaleDateString()}</time>`
            : '';
          return `<li style="margin-bottom:.8rem"><a href="/blog/${slug}" style="color:#0070f3">${slug}</a>${date}</li>`;
        }).join('')
      }</ul>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>LaikaCMS Blog</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:720px;margin:48px auto;padding:0 24px;color:#111}
  nav{display:flex;align-items:center;gap:24px;margin-bottom:40px;border-bottom:1px solid #eee;padding-bottom:16px}
  nav strong{font-size:1.1rem}
  a{color:#0070f3;text-decoration:none}
  a:hover{text-decoration:underline}
  h1{font-size:1.6rem;margin-bottom:24px}
</style>
</head><body>
<nav>
  <strong>LaikaCMS Blog</strong>
  <a href="/admin/">Open CMS ↗</a>
  <span style="flex:1"></span>
  <small style="color:#999">content: ${contentDir}</small>
</nav>
<h1>Posts</h1>
${listHtml}
</body></html>`);
  });

  // --- Blog post -----------------------------------------------------------
  expressApp.get('/blog/:slug', async (req, res) => {
    const slug = req.params['slug'] ?? '';
    let doc;
    try {
      doc = await runTask(laika.documents.getDocument(`posts/${slug}.md`));
    } catch {
      res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not Found</title></head><body><h1>Post not found</h1><p><a href="/">← Back</a></p></body></html>`,
      );
      return;
    }

    const { title, body } = doc.content as PostContent;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${title ?? slug}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:720px;margin:48px auto;padding:0 24px}a{color:#0070f3}</style>
</head><body>
<p><a href="/">← Back</a></p>
<h1>${title ?? slug}</h1>
<article>${body ?? ''}</article>
</body></html>`);
  });

  // Bind to random port on loopback only — never exposed on the network.
  const httpServer = createServer(expressApp);
  httpServer.listen(0, '127.0.0.1', () => {
    const { port } = httpServer.address() as AddressInfo;
    console.log(`LaikaCMS Blog: http://127.0.0.1:${port}`);
    console.log(`Content dir: ${contentDir}`);

    const win = new BrowserWindow({
      width: 1280,
      height: 900,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.loadURL(`http://127.0.0.1:${port}/`);

    // Open external links (e.g., Decap docs) in the system browser.
    win.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url);
      return { action: 'deny' };
    });
  });
});
