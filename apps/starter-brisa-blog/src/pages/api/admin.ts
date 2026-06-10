import type { RequestContext } from 'brisa';

import { decapAdminHtml } from '@laikacms/decap-integrations/embedded';

import { decapConfig } from '../../lib/laika.ts';

// Pre-rendered at server startup — no per-request cost.
const ADMIN_HTML = decapAdminHtml({
  title: 'Admin · Brisa Blog Starter',
  decapConfig,
});

// Brisa API routes (src/pages/api/) export a default function that receives a
// RequestContext (extends WHATWG Request) and returns a Response. No JSX, no
// layout wrapping — ideal for the Decap CMS admin shell which must own the
// entire HTML document.
export default function adminHandler(_req: RequestContext): Response {
  return new Response(ADMIN_HTML, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
