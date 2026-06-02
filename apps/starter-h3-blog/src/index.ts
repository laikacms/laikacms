/**
 * H3 blog server.
 *
 * H3 is the HTTP toolkit that powers Nitro (and by extension Nuxt). Using it
 * directly—without Nitro's build tooling—shows the WHATWG-native primitives:
 *
 *   toWebRequest(event)        Convert H3 event → WHATWG Request
 *   sendWebResponse(event, r)  Write WHATWG Response → H3 event
 *
 * This makes the Decap proxy a two-liner: convert the incoming request,
 * hand it to laika.fetch(), and forward the response. No bridging code.
 */
import { createReadStream, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';

import {
  createApp,
  createRouter,
  defineEventHandler,
  getRouterParam,
  sendWebResponse,
  serveStatic,
  setResponseHeader,
  toNodeListener,
  toWebRequest,
} from 'h3';
import { collectStream, runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { laika } from './laika.js';

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

const app = createApp();
const router = createRouter();

/**
 * Decap JSON:API proxy.
 *
 * toWebRequest(event) converts H3's event (backed by Node.js IncomingMessage)
 * into a WHATWG Request. laika.fetch() returns a WHATWG Response.
 * sendWebResponse(event, response) writes that response back through H3.
 *
 * This is the same pattern Nitro uses internally in its h3 integration.
 * Using it here without Nitro shows the raw primitive.
 */
router.use(
  '/api/decap/**',
  defineEventHandler(async event => {
    const request = toWebRequest(event);
    const response = await laika.fetch(request);
    return sendWebResponse(event, response);
  }),
);

// Blog homepage — list published posts.
router.get(
  '/',
  defineEventHandler(async event => {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    type PostSummary = { key: string, updatedAt?: string, type: string };

    const posts = (records as PostSummary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    const items = posts.map(p => {
      const slug = p.key.replace(/^posts\//, '').replace(/\.md$/, '');
      return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${
        p.updatedAt ? ` · <time>${new Date(p.updatedAt).toLocaleDateString()}</time>` : ''
      }</li>`;
    });

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items.join('\n      ')}\n    </ul>`;

    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem">
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin/">Admin →</a></p>
</body>
</html>`;
  }),
);

// Individual blog post.
router.get(
  '/blog/:slug',
  defineEventHandler(async event => {
    const slug = getRouterParam(event, 'slug');
    if (!slug) return sendWebResponse(event, new Response('Not found', { status: 404 }));

    let post;
    try {
      post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch (err) {
      if (err instanceof LaikaError) {
        return sendWebResponse(event, new Response('Not found', { status: 404 }));
      }
      throw err;
    }

    const { title, date, description, body } = post.content as PostContent;

    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
    return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${
      title ?? slug
    }</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:sans-serif;max-width:640px;margin:2rem auto;padding:0 1rem">
  <article>
    <h1>${title ?? slug}</h1>
    ${date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : ''}
    ${description ? `<p><em>${description}</em></p>` : ''}
    ${/* body is raw markdown — pipe through remark/rehype in production */ ''}
    <pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>
  </article>
  <p><a href="/">← Back</a></p>
</body>
</html>`;
  }),
);

/**
 * Static file serving for public/ directory.
 *
 * H3's serveStatic reads files from the filesystem given a getContents
 * function. This serves the admin page, the esbuild-built admin bundle,
 * and uploaded media.
 */
router.use(
  '/**',
  defineEventHandler(event => {
    return serveStatic(event, {
      getContents: id => {
        const fsPath = join(process.cwd(), 'public', id);
        if (!existsSync(fsPath)) return undefined;
        return Readable.toWeb(createReadStream(fsPath)) as ReadableStream<Uint8Array>;
      },
      getMeta: id => {
        const fsPath = join(process.cwd(), 'public', id);
        if (!existsSync(fsPath)) return undefined;
        const type = MIME[extname(id)] ?? 'application/octet-stream';
        return { type };
      },
    });
  }),
);

app.use(router);

const port = Number(process.env.PORT ?? 3000);
createServer(toNodeListener(app)).listen(port, () => {
  console.log(`Blog:  http://localhost:${port}`);
  console.log(`Admin: http://localhost:${port}/admin/`);
});
