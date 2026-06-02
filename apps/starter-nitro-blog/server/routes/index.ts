import { defineEventHandler } from 'h3';
import { collectStream } from 'laikacms/compat';

import { laika } from '../utils/laika.js';

function page(body: string, title = 'Blog'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

export default defineEventHandler(async () => {
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
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  const slug = (key: string) => key.replace(/^posts\//, '').replace(/\.md$/, '');

  const body = posts.length === 0
    ? '<h1>Blog</h1><p>No posts yet. <a href="/admin">Open the CMS</a></p>'
    : `<h1>Blog</h1><ul>${posts.map(p => `<li><a href="/blog/${slug(p.key)}">${slug(p.key)}</a></li>`).join('')}</ul>`;

  return new Response(page(`${body}<p><a href="/admin">Edit in CMS →</a></p>`), {
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
});
