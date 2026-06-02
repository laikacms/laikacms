import type { Request as ExpressRequest } from 'express';
import { collectStream, runTask } from 'laikacms/compat';
import { Get, Produces, Request, Response, Route, SuccessResponse } from 'tsoa';

import { laika } from '../laika.js';

// tsoa validates + serialises return values to JSON by default.
// @Produces('text/html') tells tsoa to skip JSON serialisation for this route.
@Route()
export class BlogController {
  @Get('/')
  @Produces('text/html')
  @SuccessResponse(200, 'Blog index')
  @Response(200, 'OK')
  async index(): Promise<string> {
    const { items } = await collectStream(
      laika.documents.listRecordSummaries({
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

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Blog · LaikaCMS + tsoa</title></head>
<body>
  <h1>Blog</h1>
  <ul>${listItems || '<li>No posts yet</li>'}</ul>
  <p><a href="/admin">Open admin</a></p>
</body>
</html>`;
  }

  @Get('/blog/{slug}')
  @Produces('text/html')
  @SuccessResponse(200, 'Blog post')
  async getPost(slug: string, @Request() req: ExpressRequest): Promise<string> {
    // tsoa passes path params as method arguments; `req` is injected via @Request()
    // for access to the raw Express request when needed.
    void req; // unused but shows the @Request() pattern

    type PostRecord = { fields: { title?: string, body?: string } };
    let record: PostRecord;
    try {
      record = (await runTask(
        laika.documents.getDocument({ folder: 'posts', key: slug }),
      )) as PostRecord;
    } catch {
      // tsoa route handlers are wrapped by generated code; throw to trigger 404
      const err: Error & { status?: number } = new Error(`Post not found: ${slug}`);
      err.status = 404;
      throw err;
    }

    const title = record.fields.title ?? slug;
    const body = record.fields.body ?? '';
    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} · LaikaCMS + tsoa</title></head>
<body>
  <a href="/">← All posts</a>
  <h1>${title}</h1>
  <div>${body}</div>
</body>
</html>`;
  }
}
