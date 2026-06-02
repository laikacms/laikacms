import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response as ExpressRes } from 'express';
import { collectStream, runTask } from 'laikacms/compat';

import { LaikaService } from '../laika.service.js';

@Controller()
export class BlogController {
  constructor(private readonly laika: LaikaService) {}

  @Get('/')
  async index(@Res() res: ExpressRes) {
    const { items: records } = await collectStream(
      this.laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    type PostSummary = { type: string, key: string, updatedAt?: string };

    const posts = (records as PostSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

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

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html>
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
  async post(@Param('slug') slug: string, @Res() res: ExpressRes) {
    try {
      const post = await runTask(this.laika.documents.getDocument(`posts/${slug}`));
      const { title, date, description, body } = post.content as {
        title?: string,
        date?: string,
        description?: string,
        body?: string,
      };

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(`<!doctype html>
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
    } catch {
      res.status(404).send('Not found');
    }
  }
}
