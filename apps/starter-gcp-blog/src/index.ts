import type { Request, Response } from '@google-cloud/functions-framework';
import { http } from '@google-cloud/functions-framework';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

function page(body: string, title = 'Blog'): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`;
}

/*
 * Doc gap: @google-cloud/functions-framework uses Express-compatible
 * Request and Response types. This means the Decap proxy bridge is identical
 * to the Express/Koa pattern: collect raw body bytes from req, build a WHATWG
 * Request, call laika.fetch(), write the WHATWG Response back to res.
 *
 * Key difference from Lambda/Azure: no event shape conversion — the Express
 * req already has req.url, req.method, and req.headers in a usable form.
 *
 * Doc gap: GCP Cloud Functions v2 deploys a single exported function. The
 * functions-framework allows registering multiple named functions from one
 * file using http('name', handler), but only the --target is invoked per
 * deployment. For a blog with multiple routes, use a single catch-all function
 * that does its own routing internally (the 'blog' function below).
 *
 * Doc gap: functions-framework reads body via req.rawBody (Buffer) when
 * rawBody is available, but unlike Express body-parser it does NOT consume
 * the stream. If req.rawBody is undefined, collect from stream manually.
 */

async function collectBody(req: Request): Promise<Buffer> {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (rawBody) return rawBody;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

http('blog', async (req: Request, res: Response) => {
  const method = req.method ?? 'GET';
  const host = req.headers['host'] ?? 'localhost';
  const pathname = new URL(req.url ?? '/', `http://${host}`).pathname;

  if (pathname.startsWith('/api/decap')) {
    const url = new URL(req.url ?? '/', `http://${host}`);
    const rawBody = await collectBody(req);
    let body: ArrayBuffer | undefined;
    if (rawBody.byteLength > 0 && method !== 'GET' && method !== 'HEAD') {
      body = rawBody.buffer.slice(rawBody.byteOffset, rawBody.byteOffset + rawBody.byteLength) as ArrayBuffer;
    }
    const webReq = new Request(url.toString(), {
      method,
      headers: req.headers as Record<string, string>,
      body,
      ...(body ? { duplex: 'half' } : {}),
    } as RequestInit);
    const webRes = await laika.fetch(webReq);
    res.status(webRes.status);
    webRes.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
    });
    res.end(Buffer.from(await webRes.arrayBuffer()));
    return;
  }

  if (pathname === '/' || pathname === '') {
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
    const bodyStr = posts.length === 0
      ? '<h1>Blog</h1><p>No posts yet. <a href="/admin">Open the CMS</a></p>'
      : `<h1>Blog</h1><ul>${
        posts.map(p => `<li><a href="/blog/${slug(p.key)}">${slug(p.key)}</a></li>`).join('')
      }</ul>`;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(page(`${bodyStr}<p><a href="/admin">Edit in CMS →</a></p>`));
    return;
  }

  const postMatch = /^\/blog\/([^/]+)$/.exec(pathname);
  if (postMatch) {
    const postSlug = postMatch[1]!;
    let post: PostContent;
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${postSlug}`));
      post = doc.content as PostContent;
    } catch {
      res.status(404).send(page('<p>Post not found. <a href="/">← Back</a></p>', '404'));
      return;
    }
    const bodyStr = `
      <article>
        <h1>${post.title ?? postSlug}</h1>
        ${post.date ? `<time>${new Date(post.date).toLocaleDateString()}</time>` : ''}
        ${post.description ? `<p><em>${post.description}</em></p>` : ''}
        <pre style="white-space:pre-wrap;font-family:inherit">${post.body ?? ''}</pre>
      </article>
      <p><a href="/">← Back</a></p>`;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.send(page(bodyStr, post.title ?? postSlug));
    return;
  }

  res.status(404).send(page('<p>Not found. <a href="/">← Back</a></p>', '404'));
});
