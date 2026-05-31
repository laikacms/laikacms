import type { Config } from '@netlify/functions';

import { collectStream, runTask } from 'laikacms/compat';

import { laika } from '../../src/lib/laika.js';

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/') {
    return renderHome();
  }

  const postMatch = url.pathname.match(/^\/blog\/([^/]+)\/?$/);
  if (postMatch) {
    return renderPost(postMatch[1]);
  }

  return new Response('Not Found', { status: 404 });
}

export const config: Config = {
  path: ['/', '/blog/*'],
};

async function renderHome(): Promise<Response> {
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

  const listHtml = posts.length === 0
    ? `<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>`
    : `<ul style="list-style:none;padding:0">${
      posts
        .map(post => {
          const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
          const date = post.updatedAt ? new Date(post.updatedAt).toLocaleDateString() : '';
          return `<li style="margin-bottom:1.5rem"><a href="/blog/${slug}">${slug}</a>${
            date ? ` · <time>${date}</time>` : ''
          }</li>`;
        })
        .join('')
    }</ul>`;

  return html(
    `<h1>My Blog</h1>${listHtml}`,
    'My Blog',
  );
}

async function renderPost(slug: string): Promise<Response> {
  const post = await runTask(laika.documents.getDocument(`posts/${slug}`)).catch(() => null);
  if (!post) return new Response('Not Found', { status: 404 });

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  const dateHtml = date ? `<time>${new Date(date).toLocaleDateString()}</time>` : '';
  const descHtml = description ? `<p><em>${description}</em></p>` : '';

  return html(
    `<article>
  <h1>${escHtml(title ?? slug)}</h1>
  ${dateHtml}
  ${descHtml}
  <pre style="white-space:pre-wrap;font-family:inherit">${escHtml(body ?? '')}</pre>
</article>
<p><a href="/">← Back</a></p>`,
    title ?? slug,
  );
}

function html(body: string, title: string): Response {
  return new Response(
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:0 auto;padding:2rem 1rem}</style>
</head>
<body>${body}</body>
</html>`,
    { headers: { 'content-type': 'text/html; charset=utf-8' } },
  );
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
