/**
 * Effect Platform blog server.
 *
 * Uses @effect/platform-node's HttpRouter + NodeHttpServer so every route
 * is a typed Effect rather than a raw callback. LaikaCMS's
 * (Request) => Promise<Response> handler lives inside a catch-all route
 * bridged via HttpServerRequest.toWeb / HttpServerResponse.fromWeb.
 *
 * Route map:
 *   GET /            — blog home (lists published posts)
 *   GET /blog/:slug  — individual post
 *   GET /admin       — Decap CMS shell (loaded from CDN)
 *   *   /api/decap/* — JSON:API proxy to embedded laika handler
 *
 * Effect Platform 4.x API notes:
 *   - HTTP types live in `effect/unstable/http/*`, NOT `@effect/platform`
 *   - `HttpRouter.add(method, path, handler)` returns a Layer, not an Effect
 *   - Use Effect.result() instead of Effect.catchAll() for error handling
 *   - Use HttpServerRequest.toWeb / HttpServerResponse.fromWeb to bridge WHATWG
 */
import { NodeHttpServer, NodeRuntime } from '@effect/platform-node';
import { decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as Result from 'effect/Result';
import * as HttpRouter from 'effect/unstable/http/HttpRouter';
import * as HttpServerRequest from 'effect/unstable/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/unstable/http/HttpServerResponse';
import { collectStream, runTask } from 'laikacms/compat';
import { createServer } from 'node:http';

import { laika } from './laika.js';

const PORT = Number(process.env.PORT ?? 3000);

function page(title: string, body: string): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.html(
    `<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><title>${title}</title></head>\n<body>\n${body}\n</body>\n</html>`,
  );
}

// ── Blog home ────────────────────────────────────────────────────────────────

const HomeRoute = HttpRouter.add(
  'GET',
  '/',
  Effect.promise(async () => {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = records
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    const items = posts
      .map(post => {
        const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
        const date = post.updatedAt
          ? ` · <time style="color:#666;font-size:.9em">${new Date(post.updatedAt).toLocaleDateString()}</time>`
          : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
      })
      .join('\n');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">${items}</ul>`;

    return page('My Blog', `<h1>My Blog</h1>\n  ${body}\n  <p><a href="/admin">Admin →</a></p>`);
  }),
);

// ── Individual post ───────────────────────────────────────────────────────────

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

const PostRoute = HttpRouter.add(
  'GET',
  '/blog/:slug',
  Effect.fn('blog-post')(function*(_req: HttpServerRequest.HttpServerRequest) {
    const params = yield* HttpRouter.params;
    const slug = params.slug ?? '';

    const docResult = yield* Effect.result(
      Effect.promise(() => runTask(laika.documents.getDocument(`posts/${slug}`))),
    );

    if (Result.isFailure(docResult)) {
      return page('Not Found', '<h1>Not Found</h1><p><a href="/">← Back</a></p>').pipe(
        HttpServerResponse.setStatus(404),
      );
    }

    const { title, date, description, body } = docResult.success.content as PostContent;

    return page(
      title ?? slug,
      [
        `<article>`,
        `<h1>${title ?? slug}</h1>`,
        date ? `<time style="color:#666">${new Date(date).toLocaleDateString()}</time>` : '',
        description ? `<p><em>${description}</em></p>` : '',
        `<pre style="white-space:pre-wrap;font-family:inherit">${body ?? ''}</pre>`,
        `</article>`,
        `<p><a href="/">← Back</a></p>`,
      ].join('\n'),
    );
  }),
);

// ── Admin shell ───────────────────────────────────────────────────────────────

const AdminRoute = HttpRouter.add(
  'GET',
  '/admin',
  // decapAdminHtml() returns a complete HTML page that loads Decap CMS from CDN,
  // registers the laika backend, and calls CMS.init() — no bundling required.
  HttpServerResponse.html(decapAdminHtml({ decapConfig: minimalBlogConfig() })),
);

// ── Laika JSON:API catch-all ──────────────────────────────────────────────────

const LaikaRoute = HttpRouter.add(
  '*',
  '/api/decap/*',
  // laika.fetch is (Request) => Promise<Response> (WHATWG web standard).
  // HttpServerRequest.toWeb converts the Effect request to a WHATWG Request;
  // HttpServerResponse.fromWeb converts the Response back.
  // This two-line bridge works for any (Request) => Promise<Response> handler.
  Effect.fn('laika.fetch')(function*(request: HttpServerRequest.HttpServerRequest) {
    const webReq = yield* HttpServerRequest.toWeb(request);
    const webRes = yield* Effect.promise(() => laika.fetch(webReq));
    return HttpServerResponse.fromWeb(webRes);
  }),
);

// ── Server ────────────────────────────────────────────────────────────────────

const App = Layer.mergeAll(HomeRoute, PostRoute, AdminRoute, LaikaRoute, HttpRouter.cors());

const ServerLayer = HttpRouter.serve(App).pipe(
  Layer.provide(NodeHttpServer.layer(createServer, { port: PORT })),
);

NodeRuntime.runMain(
  Layer.launch(ServerLayer).pipe(
    Effect.tap(() => Effect.log(`Effect Platform blog → http://localhost:${PORT}  (admin: /admin)`)),
  ),
);
