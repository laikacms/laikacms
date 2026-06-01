import type { Handlers } from '$fresh/server.ts';
import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

import { blogCollections } from '../lib/decap-config.ts';

/**
 * Decap CMS admin shell.
 *
 * Return a raw Response so Fresh does NOT try to render a Preact component
 * tree. Decap CMS expects to own the entire <html> document (it mounts its
 * React root at document.body). Fresh's SSR hydration would conflict, causing
 * duplicate roots and broken UI.
 *
 * decapAdminHtml() from @laikacms/decap-integrations/embedded handles all
 * the Decap CDN script tag, laika backend registration, and CMS.init() call —
 * no manual 50-line HTML needed.
 */
export const handler: Handlers = {
  GET() {
    return new Response(
      decapAdminHtml({
        decapConfig: {
          backend: { name: 'laika', api_url: '/api/decap' },
          media_folder: 'public/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      }),
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  },
};
