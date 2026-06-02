import { Controller, Get, Inject, Param } from '@midwayjs/core';
import type { Context } from '@midwayjs/koa';
import { collectStream, runTask } from 'laikacms/compat';

import { LaikaService } from '../service/laika.service.js';

@Controller('/')
export class BlogController {
  @Inject()
  ctx!: Context;

  @Inject()
  laikaService!: LaikaService;

  @Get('/')
  async index(): Promise<void> {
    const { items } = await collectStream(
      this.laikaService.laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    type RecordSummary = { type: string, key: string, updatedAt?: string };
    const posts = (items as RecordSummary[]).filter(r => r.type === 'post');
    const listItems = posts
      .map(r => `<li><a href="/blog/${r.key}">${r.key}</a></li>`)
      .join('\n');

    this.ctx.type = 'text/html; charset=utf-8';
    this.ctx.body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Blog · LaikaCMS + Midway.js</title></head>
<body>
  <h1>Blog</h1>
  <ul>${listItems || '<li>No posts yet</li>'}</ul>
  <p><a href="/admin">Open admin</a></p>
</body>
</html>`;
  }

  @Get('/admin')
  admin(): void {
    this.ctx.type = 'text/html; charset=utf-8';
    this.ctx.body = this.laikaService.adminHtml;
  }

  @Get('/blog/:slug')
  async post(@Param('slug') slug: string): Promise<void> {
    type PostRecord = { fields: { title?: string, body?: string } };
    let record: PostRecord;
    try {
      record = (await runTask(
        this.laikaService.laika.documents.getDocument({ folder: 'posts', key: slug }),
      )) as PostRecord;
    } catch {
      this.ctx.status = 404;
      this.ctx.type = 'text/html; charset=utf-8';
      this.ctx.body = `<!DOCTYPE html><html><body><h1>404 – Post not found</h1><a href="/">Home</a></body></html>`;
      return;
    }

    const title = record.fields.title ?? slug;
    const body = record.fields.body ?? '';
    this.ctx.type = 'text/html; charset=utf-8';
    this.ctx.body = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} · LaikaCMS + Midway.js</title></head>
<body>
  <a href="/">← All posts</a>
  <h1>${title}</h1>
  <div>${body}</div>
</body>
</html>`;
  }
}
