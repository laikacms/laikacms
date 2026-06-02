/**
 * Decap JSON:API — proxy all /api/decap/* requests to laika.fetch.
 *
 * SolidStart API routes receive a standard Web API Request via APIEvent,
 * which is exactly what laika.fetch expects — no adapter needed.
 *
 * Doc note: the `...path` catch-all must cover every method that Decap CMS
 * uses. SolidStart API routes require explicit method exports (no wildcard
 * method handler), so we export GET/POST/PUT/DELETE/PATCH individually.
 */
import type { APIEvent } from '@solidjs/start/server';

import { laika } from '~/lib/laika.js';

const handle = (event: APIEvent) => laika.fetch(event.request);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
export const HEAD = handle;
export const OPTIONS = handle;
