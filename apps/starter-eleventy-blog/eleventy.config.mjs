/**
 * Eleventy 3 configuration.
 *
 * Key integration: the dev server middleware intercepts /api/decap/* requests
 * and forwards them to laika.fetch (Web API Request/Response), enabling the
 * Decap admin UI to work without a separate API server during development.
 *
 * Doc note: laika.fetch expects a WHATWG Fetch Request. Eleventy's dev server
 * passes Node.js http.IncomingMessage, so we convert it manually — same
 * adapter pattern used in starter-express-blog.
 */
import { laika } from './src/lib/laika.js';

/** @param {import("node:http").IncomingMessage} req */
async function incomingToWebRequest(req) {
  const host = req.headers['host'] ?? 'localhost:8080';
  const url = new URL(req.url ?? '/', `http://${host}`);

  let body;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const buf = Buffer.concat(chunks);
    if (buf.byteLength > 0) {
      body = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    }
  }

  return new Request(url.toString(), {
    method: req.method ?? 'GET',
    headers: /** @type {Record<string,string>} */ (
      Object.fromEntries(
        Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
      )
    ),
    body,
  });
}

/** @type {import("@11ty/eleventy").UserConfig} */
export default function(eleventyConfig) {
  // Copy public/ assets (admin HTML + bundle.js, uploads, etc.) straight to _site/
  eleventyConfig.addPassthroughCopy('public');

  // Wire up the Decap JSON:API in the dev server so `eleventy --serve` is
  // the only process you need to start — no separate API server required.
  eleventyConfig.setServerOptions({
    /** @type {Array<(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, next: () => void) => void>} */
    middleware: [
      function laikaApiMiddleware(req, res, next) {
        if (!req.url?.startsWith('/api/decap')) return next();

        void incomingToWebRequest(req)
          .then(webReq => laika.fetch(webReq))
          .then(async webRes => {
            res.statusCode = webRes.status;
            webRes.headers.forEach((value, name) => {
              if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
            });
            res.end(Buffer.from(await webRes.arrayBuffer()));
          })
          .catch(err => {
            console.error('[laika] API error:', err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end('Internal Server Error');
            }
          });
      },
    ],
  });

  return {
    dir: {
      input: 'src',
      output: '_site',
      includes: '_includes',
      data: '_data',
    },
    templateFormats: ['njk', 'md', 'html'],
    htmlTemplateEngine: 'njk',
    markdownTemplateEngine: 'njk',
  };
}
