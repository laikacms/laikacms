import { Controller, Get, Param, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { collectStream, runTask } from 'laikacms/compat';

import { LaikaService } from '../laika.service.js';

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${escHtml(title)}</title>
  <style>body{max-width:48rem;margin:0 auto;padding:2rem 1rem;font-family:system-ui,sans-serif}</style>
</head>
<body>
  <nav><a href="/" style="font-weight:bold">My Blog</a> · <a href="/admin">CMS</a></nav>
  ${body}
</body>
</html>`;
}

@Controller()
export class BlogController {
  constructor(private readonly laika: LaikaService) {}

  @Get('/admin')
  admin(@Res() reply: FastifyReply) {
    reply.header('Content-Type', 'text/html; charset=utf-8').send(this.laika.adminHtml);
  }

  @Get('/')
  async index(@Res() reply: FastifyReply) {
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
        return `<li style="margin-bottom:1rem"><a href="/blog/${escHtml(slug)}">${escHtml(slug)}</a>${date}</li>`;
      })
      .join('\n');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">${items}</ul>`;

    reply.header('Content-Type', 'text/html; charset=utf-8').send(page('My Blog', `<h1>My Blog</h1>${body}`));
  }

  @Get('/blog/:slug')
  async post(@Param('slug') slug: string, @Res() reply: FastifyReply) {
    try {
      const post = await runTask(this.laika.documents.getDocument(`posts/${slug}`));
      const { title, date, description, body } = post.content as {
        title?: string,
        date?: string,
        description?: string,
        body?: string,
      };

      const html = `
        <article>
          <h1>${escHtml(title ?? slug)}</h1>
          ${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
          ${description ? `<p><em>${escHtml(description)}</em></p>` : ''}
          <pre style="white-space:pre-wrap;font-family:inherit">${escHtml(body ?? '')}</pre>
          <p><a href="/">← Back</a></p>
        </article>`;

      reply.header('Content-Type', 'text/html; charset=utf-8').send(page(title ?? slug, html));
    } catch {
      reply.code(404).send('Not found');
    }
  }
}
