import type { HttpContext } from '@adonisjs/core/http';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';
import { laika } from '#services/laika';
import { blogCollections } from '#services/decap_config';

/**
 * Bridge an AdonisJS HttpContext to a WHATWG Request so laika.fetch can handle it.
 *
 * AdonisJS uses Node.js IncomingMessage under the hood. The bodyParser middleware
 * in kernel.ts may have already consumed the raw body stream for JSON/form routes.
 *
 * For the Decap JSON:API we read the raw body via request.raw() — AdonisJS caches
 * the raw string body before it parses it, so request.raw() is safe to call even
 * after the body has been parsed. Binary bodies (file uploads) are accessed via
 * request.multipart — for now we forward an empty body for multipart; Decap's
 * media upload endpoint uses multipart which requires a fuller adapter (see README).
 */
async function toLaikaRequest(ctx: HttpContext): Promise<Request> {
  const { request } = ctx;
  const host = request.header('host') ?? 'localhost';
  const url = new URL(request.url(), `http://${host}`);
  const method = request.method().toUpperCase();

  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const raw = request.raw();
    if (raw !== null) {
      body = raw;
    }
  }

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers())) {
    if (value !== undefined) {
      headers[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }

  return new Request(url, { method, headers, body });
}

export default class DecapController {
  /**
   * Forward all /api/decap/* requests to laika.fetch.
   */
  async handle(ctx: HttpContext): Promise<void> {
    const { response } = ctx;
    const webRequest = await toLaikaRequest(ctx);
    const webResponse = await laika.fetch(webRequest);

    response.status(webResponse.status);
    webResponse.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'transfer-encoding') {
        response.header(name, value);
      }
    });

    const body = Buffer.from(await webResponse.arrayBuffer());
    response.send(body);
  }

  /**
   * Serve the Decap CMS admin shell as a raw HTML response.
   * AdonisJS edge templates are not used here — decapAdminHtml() returns
   * a complete standalone page that must not be wrapped in any layout.
   */
  admin({ response }: HttpContext): void {
    response.header('content-type', 'text/html; charset=utf-8');
    response.send(
      decapAdminHtml({
        decapConfig: {
          backend: { name: 'laika', api_url: '/api/decap' },
          media_folder: 'public/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      }),
    );
  }
}
