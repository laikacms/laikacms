import { inject } from '@loopback/core';
import { get, param, RestBindings } from '@loopback/rest';
import type { Response } from '@loopback/rest';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from '../laika.js';

// LoopBack 4 returns strings as text/plain by default.  Inject the raw
// response object so we can set Content-Type to text/html ourselves.
export class BlogController {
  constructor(
    @inject(RestBindings.Http.RESPONSE) private readonly res: Response,
  ) {}

  @get('/', {
    responses: { '200': { description: 'Blog index', content: { 'text/html': {} } } },
  })
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

    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Blog · LaikaCMS + LoopBack 4</title></head>
<body>
  <h1>Blog</h1>
  <ul>${listItems || '<li>No posts yet</li>'}</ul>
  <p><a href="/admin">Open admin</a></p>
</body>
</html>`;

    this.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }

  @get('/blog/{slug}', {
    responses: { '200': { description: 'Blog post', content: { 'text/html': {} } } },
  })
  async post(
    @param.path.string('slug') slug: string,
  ): Promise<string> {
    type PostRecord = { fields: { title?: string, body?: string } };
    let record: PostRecord;
    try {
      record = (await runTask(
        laika.documents.getDocument({ folder: 'posts', key: slug }),
      )) as PostRecord;
    } catch {
      this.res.status(404).setHeader('Content-Type', 'text/html; charset=utf-8');
      return `<!DOCTYPE html><html><body><h1>404 – Post not found</h1><a href="/">Home</a></body></html>`;
    }

    const title = record.fields.title ?? slug;
    const body = record.fields.body ?? '';
    const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>${title} · LaikaCMS + LoopBack 4</title></head>
<body>
  <a href="/">← All posts</a>
  <h1>${title}</h1>
  <div>${body}</div>
</body>
</html>`;

    this.res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return html;
  }
}
