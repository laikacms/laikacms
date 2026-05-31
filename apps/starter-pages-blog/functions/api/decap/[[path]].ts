/**
 * Catch-all Pages Function for the Decap JSON:API.
 *
 * Matches every request to /api/decap/* and proxies it to the LaikaCMS
 * `decapApi` router.  The double-bracket [[path]] syntax is Cloudflare Pages'
 * way of creating a catch-all route segment.
 *
 * Pages Functions run on the Workers edge runtime — `createEmbeddedLaika`
 * is not available here.  See src/laika-factory.ts for the manual wiring.
 */
import { type Env, getLaika } from '../../../src/laika-factory.js';

export const onRequest: PagesFunction<Env> = async context => {
  const { api } = await getLaika(context.env);
  return api.fetch(context.request);
};
