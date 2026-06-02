// @ts-types="npm:laikacms/compat"
import { collectStream, runTask } from 'laikacms/compat';
// @ts-types="npm:laikacms/core"
import { NotFoundError } from 'laikacms/core';

import { laika } from './lib/laika.ts';

const PORT = Number(Deno.env.get('PORT') ?? 3000);
const ADMIN_HTML = await Deno.readTextFile(new URL('./admin/index.html', import.meta.url));

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
    .filter((item: { type: string }) => item.type === 'published')
    .map((item: { key: string, content?: unknown }) => ({ key: item.key, content: item.content }));
}

Deno.serve({ port: PORT }, async request => {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === '/' && request.method === 'GET') {
    return json({
      name: '@laikacms/starter-deno-backend',
      runtime: `Deno ${Deno.version.deno}`,
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
    return json({ posts: await listPosts() });
  }

  const postMatch = path.match(/^\/posts\/([^/]+)$/);
  if (postMatch && request.method === 'GET') {
    const slug = decodeURIComponent(postMatch[1]);
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
      return json({ post: doc });
    } catch (err) {
      if (err instanceof NotFoundError) return json({ error: 'Not found' }, 404);
      throw err;
    }
  }

  return new Response('Not Found', { status: 404 });
});

console.log(`LaikaCMS Deno backend listening on http://localhost:${PORT}`);
console.log(`Deno ${Deno.version.deno} · createEmbeddedLaika (FileSystem) · Decap admin at /admin`);
