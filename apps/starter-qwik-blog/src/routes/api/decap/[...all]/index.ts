import type { RequestHandler } from '@builder.io/qwik-city';

import { laika } from '~/lib/laika.server';

/**
 * Proxy all HTTP methods to the embedded Laika/Decap JSON:API handler.
 *
 * Qwik City's RequestEvent exposes a WHATWG Request (event.request), so
 * laika.fetch receives the full URL, headers, and body without any wrapping.
 * throw send(response) stops further middleware processing (Qwik City
 * convention — send returns an AbortMessage sentinel).
 */
export const onRequest: RequestHandler = async ({ request, send }) => {
  const response = await laika.fetch(request);
  throw send(response);
};
