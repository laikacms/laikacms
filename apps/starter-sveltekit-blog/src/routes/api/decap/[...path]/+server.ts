import type { RequestHandler } from './$types';

import { laika } from '$lib/laika';

/**
 * Proxy all HTTP methods to the embedded Laika/Decap JSON:API handler.
 *
 * SvelteKit's RequestHandler receives an event whose .request is a standard
 * Web API Request, so laika.fetch receives the full URL + headers + body.
 */
const handler: RequestHandler = ({ request }) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
