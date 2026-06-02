import type { RequestHandler } from './$types';

import { makeLaika } from '$lib/laika';

/**
 * Forward all /api/decap/* requests to laika.fetch.
 *
 * platform.env.DB is the Cloudflare D1 binding — available only in a
 * Cloudflare request context, not in process.env or module scope.
 */
const handler: RequestHandler = ({ request, platform }) => {
  const laika = makeLaika(platform!.env.DB);
  return laika.fetch(request);
};

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
