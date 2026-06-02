/**
 * Vercel Edge Function — catch-all Decap JSON:API proxy.
 *
 * Matches every request to /api/decap/* and forwards it to the LaikaCMS
 * `decapApi` router.  The `[...path]` filename is Vercel's catch-all route
 * segment syntax — it matches /api/decap/, /api/decap/anything/here, etc.
 *
 * Edge Functions use the V8 runtime; `createEmbeddedLaika` (node:fs) is not
 * available.  See src/laika-factory.ts for the manual wiring with Vercel Blob.
 */
export const config = { runtime: 'edge' };

import { getLaika } from '../../src/laika-factory.js';

export default async function handler(request: Request): Promise<Response> {
  const { api } = await getLaika({
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    DEV_TOKEN: process.env.DEV_TOKEN,
  });
  return api.fetch(request);
}
