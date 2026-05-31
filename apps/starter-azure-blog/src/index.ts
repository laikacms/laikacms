import type { HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { app } from '@azure/functions';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

function htmlPage(body: string, title = 'Blog'): HttpResponseInit {
  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
    body:
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body>${body}</body></html>`,
  };
}

/*
 * Doc gap: Azure Functions v4 HttpRequest is NOT a WHATWG Request. It has
 * compatible .url, .method, .headers, and .arrayBuffer() / .text() / .json()
 * methods, but the class itself is different. To call laika.fetch() you must
 * construct a WHATWG Request from the Azure HttpRequest.
 *
 * Key difference from Lambda: HttpRequest.url is already a full URL (no
 * host reconstruction needed). HttpRequest.headers is a Headers-like object
 * with .get() / .entries() but is a plain object, not a WHATWG Headers.
 *
 * Doc gap: Azure Functions v4 programming model uses app.http() for HTTP
 * triggers. The v3 model used separate function.json files — v4 collapses
 * the config into TypeScript using app.http() / app.get() / app.post() etc.
 */

async function azureRequestToWebRequest(request: HttpRequest): Promise<Request> {
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 0) body = buf;
  }

  return new Request(request.url, {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    ...(body ? { duplex: 'half' } : {}),
  } as RequestInit);
}

async function webResponseToAzureResponse(webRes: Response): Promise<HttpResponseInit> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((value, name) => {
    if (name.toLowerCase() !== 'transfer-encoding') headers[name] = value;
  });
  return {
    status: webRes.status,
    headers,
    body: await webRes.arrayBuffer(),
  };
}

app.http('decap', {
  methods: ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT'],
  route: 'decap/{*path}',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const webReq = await azureRequestToWebRequest(request);
    const webRes = await laika.fetch(webReq);
    return webResponseToAzureResponse(webRes);
  },
});

app.http('home', {
  methods: ['GET'],
  route: '',
  handler: async (_request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
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
      ? '<h1>Blog</h1><p>No posts yet.</p>'
      : `<h1>Blog</h1><ul>${
        posts.map(p => `<li><a href="/api/blog/${slug(p.key)}">${slug(p.key)}</a></li>`).join('')
      }</ul>`;
    return htmlPage(`${body}<p><a href="/admin">Edit in CMS →</a></p>`);
  },
});

app.http('post', {
  methods: ['GET'],
  route: 'blog/{slug}',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> => {
    const postSlug = request.params['slug'] ?? '';
    let post: PostContent;
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${postSlug}`));
      post = doc.content as PostContent;
    } catch {
      return {
        status: 404,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        body: `<!doctype html><html><body><p>Post not found. <a href="/api/">← Back</a></p></body></html>`,
      };
    }
    const body = `
      <article>
        <h1>${post.title ?? postSlug}</h1>
        ${post.date ? `<time>${new Date(post.date).toLocaleDateString()}</time>` : ''}
        ${post.description ? `<p><em>${post.description}</em></p>` : ''}
        <pre style="white-space:pre-wrap;font-family:inherit">${post.body ?? ''}</pre>
      </article>
      <p><a href="/api/">← Back</a></p>`;
    return htmlPage(body, post.title ?? postSlug);
  },
});
