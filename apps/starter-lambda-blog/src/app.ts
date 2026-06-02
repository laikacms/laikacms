/**
 * Framework-agnostic request router — takes a Web API Request, returns a
 * Web API Response.  Imported by both the Lambda handler and the local dev server.
 */
import { collectStream, runTask } from 'laikacms/compat';

import { blogCollections } from './decap-config.js';
import { laika } from './laika.js';

function htmlResponse(title: string, content: string): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
a{color:#0070f3}nav{margin-bottom:2rem}</style></head>
<body><nav><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>${content}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}

const adminHtml = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><title>Blog Admin</title>
<script>window.CMS_MANUAL_INIT = true;</script>
<script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
</head><body><script type="module">
const { default: createLaikaBackend } =
  await import('https://unpkg.com/@laikacms/decap-cms-backend-laika@latest/dist/index.js');
window.CMS.registerBackend('laika', createLaikaBackend());
window.CMS.init({ config: {
  backend: { name: 'laika', api_url: '/api/decap' },
  media_folder: 'public/uploads',
  public_folder: '/uploads',
  collections: ${JSON.stringify(blogCollections)},
} });
</script></body></html>`;

export async function handleRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname.startsWith('/api/decap')) {
    return laika.fetch(request);
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    return new Response(adminHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  if (pathname === '/' || pathname === '') {
    try {
      const { items } = await collectStream(
        laika.documents.listRecordSummaries({
          pagination: { page: 1, perPage: 100 },
          folder: 'posts',
          depth: 1,
          type: 'published',
        }),
      );

      const posts = items
        .filter(r => r.type === 'published-summary')
        .sort((a, b) => {
          const aTime = 'updatedAt' in a && a.updatedAt ? a.updatedAt : '';
          const bTime = 'updatedAt' in b && b.updatedAt ? b.updatedAt : '';
          if (aTime && bTime) return bTime.localeCompare(aTime);
          return b.key.localeCompare(a.key);
        });

      const list = posts.length === 0
        ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
        : `<ul style="list-style:none;padding:0">${
          posts.map(p => {
            const slug = p.key.replace(/^posts\//, '').replace(/\.md$/, '');
            const time = 'updatedAt' in p && p.updatedAt
              ? ` · <time>${new Date(p.updatedAt).toLocaleDateString()}</time>`
              : '';
            return `<li style="margin-bottom:1.5rem"><a href="/blog/${slug}">${slug}</a>${time}</li>`;
          }).join('')
        }</ul>`;

      return htmlResponse('My Blog', `<h1>My Blog</h1>${list}`);
    } catch (err) {
      console.error('Error listing posts:', err);
      return htmlResponse('My Blog', '<h1>My Blog</h1><p>Error loading posts.</p>');
    }
  }

  const postMatch = pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (postMatch) {
    const slug = postMatch[1];
    try {
      const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
      const data = post.content as Record<string, unknown>;
      const title = typeof data.title === 'string' ? data.title : slug;
      const body = typeof data.body === 'string' ? data.body : '';
      const date = typeof data.date === 'string'
        ? `<p><time>${new Date(data.date).toLocaleDateString()}</time></p>`
        : '';
      return htmlResponse(
        title,
        `<article><h1>${title}</h1>${date}<pre style="white-space:pre-wrap">${body}</pre></article>
<p><a href="/">← Back</a></p>`,
      );
    } catch {
      return htmlResponse('Not Found', '<h1>Post not found</h1><p><a href="/">← Back</a></p>');
    }
  }

  return new Response('Not Found', { status: 404 });
}
