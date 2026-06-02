import { Context, Get, HttpResponseNotFound, HttpResponseOK } from '@foal/core';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

function html(content: string): HttpResponseOK {
  const res = new HttpResponseOK(content);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res;
}

export class BlogController {
  @Get('/')
  async index() {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    type RecordSummary = { type: string, key: string, updatedAt?: string };

    const posts = (records as RecordSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => (b.updatedAt ?? b.key).localeCompare(a.updatedAt ?? a.key));

    const items = posts
      .map(post => {
        const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
        const date = post.updatedAt
          ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
          : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
      })
      .join('\n      ');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    return html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`);
  }

  @Get('/blog/:slug')
  async show(ctx: Context) {
    const slug = ctx.request.params.slug as string;

    let post;
    try {
      post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch {
      return new HttpResponseNotFound('Post not found');
    }

    const { title, date, description, body } = post.content as {
      title?: string,
      date?: string,
      description?: string,
      body?: string,
    };

    return html(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${title ?? slug}</title></head>
<body>
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time>${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`);
  }
}
