/**
 * Vercel Edge Function — GET /api/blog/:slug  (rewritten from /blog/:slug)
 *
 * Reads a single blog post from Vercel Blob via LaikaCMS and renders HTML.
 * The /blog/:slug URL is rewritten to /api/blog/:slug by vercel.json.
 */
export const config = { runtime: 'edge' };

import { getLaika, runTask } from '../../src/laika-factory.js';

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Path is /api/blog/<slug> after Vercel processes the rewrite
  const slug = url.pathname.split('/').filter(Boolean).pop() ?? '';

  if (!slug) {
    return new Response('Not Found', { status: 404 });
  }

  const { documents } = await getLaika({
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    DEV_TOKEN: process.env.DEV_TOKEN,
  });

  try {
    const post = await runTask(documents.getDocument(`posts/${slug}`));
    const data = post.content as Record<string, unknown>;
    const title = typeof data.title === 'string' ? data.title : slug;
    const body = typeof data.body === 'string' ? data.body : '';
    const date = typeof data.date === 'string'
      ? `<p><time>${new Date(data.date).toLocaleDateString()}</time></p>`
      : '';

    return new Response(
      `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
a{color:#0070f3}nav{margin-bottom:2rem}</style></head>
<body><nav><a href="/">Home</a> · <a href="/admin/">Admin</a></nav>
<article><h1>${title}</h1>${date}<div><pre style="white-space:pre-wrap">${body}</pre></div></article>
<p><a href="/">← Back</a></p></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  } catch {
    return new Response(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not Found</title></head>
<body><h1>Post not found</h1><p><a href="/">← Back</a></p></body></html>`,
      { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}
