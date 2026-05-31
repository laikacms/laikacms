import type { APIRoute } from 'astro';

import { laika } from '../../../laika.js';

/**
 * Proxy every HTTP method to the embedded Laika/Decap JSON:API handler.
 *
 * Astro's node adapter forwards the raw Request (including URL, headers, body)
 * so laika.fetch receives the full request and routes internally using basePath.
 */
const handler: APIRoute = ({ request }) => laika.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
