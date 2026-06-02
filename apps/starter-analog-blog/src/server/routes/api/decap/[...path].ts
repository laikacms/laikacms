import { defineEventHandler, sendWebResponse, toWebRequest } from 'h3';

import { laika } from '../../../../lib/laika.js';

/**
 * Catch-all Decap API proxy.
 *
 * Analog's server layer is powered by Nitro (which uses H3 under the hood).
 * H3 provides `toWebRequest` and `sendWebResponse` so no manual
 * IncomingMessage → Request bridging is needed — the Web API flows
 * natively from the framework.
 *
 * Doc gap surfaced: unlike Express/Fastify, Nitro/H3 uses Web API Request
 * and Response throughout, making the proxy a one-liner.
 */
export default defineEventHandler(async event => {
  const request = toWebRequest(event);
  const response = await laika.fetch(request);
  return sendWebResponse(event, response);
});
