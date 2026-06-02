import type { APIRoute } from 'astro';

import { makeLaika } from '../../../laika.js';

// With @astrojs/cloudflare, D1 bindings arrive via context.locals.runtime.env
// in API routes (equivalent to Astro.locals.runtime.env in .astro pages).
const handler: APIRoute = ({ request, locals }) => {
  const laika = makeLaika(locals.runtime.env.DB);
  return laika.fetch(request);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
