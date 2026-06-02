import { type Handlers } from '$fresh/server.ts';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from '../lib/decap-config.ts';

/**
 * Decap CMS admin shell.
 *
 * Returned as a raw Response rather than using ctx.render() so Fresh does NOT
 * apply the _app.tsx layout. Decap CMS owns the full <html> document — it must
 * not be nested inside the app shell.
 *
 * decapAdminHtml() generates the complete standalone HTML page; no esbuild
 * step or public/admin/bundle.js is needed.
 */
export const handler: Handlers = {
  GET() {
    return new Response(
      decapAdminHtml({
        decapConfig: {
          backend: { name: 'laika', api_url: '/api/decap' },
          media_folder: 'static/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      }),
      { headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  },
};
