import type { Config } from '@netlify/functions';

import { laika } from '../../src/lib/laika.js';

/**
 * Proxy every HTTP method to the embedded Laika/Decap JSON:API handler.
 *
 * Netlify Functions v2 passes a WHATWG-native Request, so no bridging
 * is needed — this is the zero-adapter pattern.
 */
export default async function handler(req: Request): Promise<Response> {
  return laika.fetch(req);
}

export const config: Config = {
  path: '/api/decap/*',
};
