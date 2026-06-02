/* eslint-disable @typescript-eslint/no-require-imports */
'use strict';

// LaikaCMS packages are ESM-only.  In a CJS Sails app the only way to consume
// them is via dynamic import(), which is async.  We initialise once and cache.

const path = require('path');

/** @type {import('@laikacms/decap-integrations/embedded').createEmbeddedLaika extends (...args: any[]) => infer R ? R : never} */
let laika = null;
let adminHtml = null;
let initPromise = null;

async function init() {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } = await import(
      '@laikacms/decap-integrations/embedded'
    );

    laika = createEmbeddedLaika({
      contentDir: path.resolve(process.cwd(), 'content'),
      basePath: '/api/decap',
      auth: { mode: 'dev' },
      decapConfig: minimalBlogConfig(),
    });

    adminHtml = decapAdminHtml();
  })();
  return initPromise;
}

// Kick off init eagerly so the first request isn't slow.
init().catch(err => console.error('LaikaCMS init error:', err));

module.exports = {
  // Serve the Decap admin SPA.
  async admin(req, res) {
    await init();
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(adminHtml);
  },

  // Forward all /api/decap/* requests to laika.fetch().
  // req.body is a Buffer set by the rawDecapBody middleware in config/http.js.
  async decapProxy(req, res) {
    await init();

    const host = req.headers.host ?? 'localhost';
    const url = new URL(req.url, `http://${host}`);

    const rawBuf = Buffer.isBuffer(req.body) && req.body.byteLength > 0
      ? req.body
      : null;

    // TypeScript 6 changed Buffer's ArrayBuffer type; for plain JS we still need
    // the slice to produce a concrete ArrayBuffer (not Buffer<ArrayBufferLike>).
    const body = rawBuf
      ? rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength)
      : null;

    const webReq = new Request(url.toString(), {
      method: req.method,
      headers: req.headers,
      body,
      ...(body ? { duplex: 'half' } : {}),
    });

    const webRes = await laika.fetch(webReq);

    res.status(webRes.status);
    webRes.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'transfer-encoding') res.set(name, value);
    });
    const buf = Buffer.from(await webRes.arrayBuffer());
    return res.send(buf);
  },

  // Blog index page.
  async index(req, res) {
    await init();
    const { collectStream } = await import('laikacms/compat');

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
          ? ` · <time>${new Date(post.updatedAt).toLocaleDateString()}</time>`
          : '';
        return `<li style="margin-bottom:1rem"><a href="/blog/${slug}">${slug}</a>${date}</li>`;
      })
      .join('\n      ');

    const body = posts.length === 0
      ? '<p>No posts yet. <a href="/admin">Open the CMS</a> to write your first post.</p>'
      : `<ul style="list-style:none;padding:0">\n      ${items}\n    </ul>`;

    const html = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>My Blog</title></head>
<body>
  <h1>My Blog</h1>
  ${body}
  <p><a href="/admin">Admin →</a></p>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  },

  // Blog post page.
  async post(req, res) {
    await init();
    const { runTask } = await import('laikacms/compat');

    const { slug } = req.params;

    let doc;
    try {
      doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch {
      return res.status(404).send('Not found');
    }

    const { title, date, description, body } = doc.content ?? {};

    const html = `<!doctype html>
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
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  },
};
