import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './lib/laika';

const PORT = Number(process.env.PORT ?? 3000);

const ADMIN_HTML = await Bun.file(new URL('./admin/index.html', import.meta.url)).text();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function listPosts() {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return items
    .filter(item => item.type === 'published')
    .map(item => ({
      key: (item as { key: string }).key,
      content: (item as { content?: unknown }).content,
    }));
}

async function getPost(slug: string) {
  try {
    return await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/' && request.method === 'GET') {
      return json({
        name: '@laikacms/starter-bun-backend',
        runtime: `Bun ${Bun.version}`,
        endpoints: {
          'GET /': 'this index',
          'GET /admin': 'Decap CMS admin shell',
          'ANY /api/decap/*': 'LaikaCMS JSON:API (auth required)',
          'GET /posts': 'public list of published posts',
          'GET /posts/:slug': 'public single-post endpoint',
        },
      });
    }

    if (path === '/admin' && request.method === 'GET') {
      return new Response(ADMIN_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    if (path.startsWith('/api/decap/')) {
      return laika.fetch(request);
    }

    if (path === '/posts' && request.method === 'GET') {
      const posts = await listPosts();
      return json({ posts });
    }

    const postMatch = path.match(/^\/posts\/([^/]+)$/);
    if (postMatch && request.method === 'GET') {
      const slug = decodeURIComponent(postMatch[1]!);
      const post = await getPost(slug);
      if (!post) return json({ error: 'Not found' }, 404);
      return json({ post });
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`LaikaCMS Bun backend listening on http://localhost:${server.port}`);
console.log(`Bun ${Bun.version} · createEmbeddedLaika (FileSystem) · Decap admin at /admin`);
