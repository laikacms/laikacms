/**
 * Express + Socket.io + LaikaCMS real-time blog.
 *
 * Doc gap surfaced: LaikaCMS has no built-in change notification API.
 * When the CMS editor publishes a post, laika.fetch writes to content/ on
 * the filesystem but emits no event that server code can subscribe to.
 *
 * Workaround: watch content/ with node:fs.watch (built-in, no extra deps)
 * and emit a Socket.io event. The browser listens and refetches the post
 * list without polling.
 *
 * Real-time flow:
 *   1. Editor opens /admin/ and creates/edits a post.
 *   2. Decap CMS calls /api/decap/* → laika.fetch writes the .md file.
 *   3. node:fs.watch detects the change → debounce 200ms → emit 'content:updated'.
 *   4. Socket.io broadcasts to all connected browsers.
 *   5. Browser refetches /posts and re-renders the list — no page reload needed.
 *
 * Note: node:fs.watch is sufficient for a single-process server on Linux/macOS.
 * For multi-process or containerised deployments, replace with Redis pub/sub or
 * a similar cross-process channel.
 */
import { watch } from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import express from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import { Server as SocketIOServer } from 'socket.io';

import { laika } from './lib/laika.js';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

const PORT = Number(process.env['PORT'] ?? 3000);
const CONTENT_DIR = path.resolve(process.cwd(), 'content');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  cors: { origin: '*' },
});

// ── Content-change watcher ───────────────────────────────────────────────────
// Watch content/ for file changes and broadcast to connected browsers.
// Debounce to avoid flooding on rapid consecutive writes (e.g. a save + index update).
let debounceTimer: NodeJS.Timeout | null = null;
const watcher = watch(CONTENT_DIR, { recursive: true }, (_event, filename) => {
  if (!filename?.endsWith('.md')) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    console.log(`[watch] content changed: ${filename} — broadcasting content:updated`);
    io.emit('content:updated', { filename });
    debounceTimer = null;
  }, 200);
});

process.on('exit', () => watcher.close());

// ── Socket.io connection log ─────────────────────────────────────────────────
io.on('connection', socket => {
  console.log(`[socket.io] client connected: ${socket.id}`);
  socket.on('disconnect', () => console.log(`[socket.io] client disconnected: ${socket.id}`));
});

// ── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.resolve(process.cwd(), 'public')));

// ── Decap JSON:API proxy ─────────────────────────────────────────────────────
app.all('/api/decap/*path', async (req, res) => {
  const host = req.headers['host'] ?? 'localhost';
  const url = new URL(req.originalUrl ?? req.url, `http://${host}`);
  const rawBody: Buffer[] = [];
  for await (const chunk of req) {
    rawBody.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const body = Buffer.concat(rawBody);
  const webReq = new Request(url.toString(), {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: body.byteLength > 0 && req.method !== 'GET' && req.method !== 'HEAD' ? body : undefined,
    ...(body.byteLength > 0 ? { duplex: 'half' } : {}),
  } as RequestInit);
  const webRes = await laika.fetch(webReq);
  res.status(webRes.status);
  webRes.headers.forEach((val, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, val);
  });
  res.end(Buffer.from(await webRes.arrayBuffer()));
});

// ── REST API for posts ────────────────────────────────────────────────────────
// Used by the client-side JavaScript to fetch post lists and content.
app.get('/posts', async (_req, res) => {
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
      updatedAt: r.updatedAt ?? null,
    }));
  res.json(posts);
});

app.get('/posts/:slug', async (req, res) => {
  const { slug } = req.params;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const { title, date, description, body } = doc.content as PostContent;
    res.json({ slug, title, date, description, body });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`\nSocket.io blog running at http://localhost:${PORT}`);
  console.log(`  Blog:       http://localhost:${PORT}/`);
  console.log(`  Admin:      http://localhost:${PORT}/admin/`);
  console.log(`  Posts API:  http://localhost:${PORT}/posts`);
  console.log('\n  Watching content/ for changes — edits in Decap will push to browsers in real time.\n');
});
