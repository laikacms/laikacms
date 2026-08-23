/**
 * The Astro route the integration injects for `api.mode: 'route'`.
 *
 * `injectRoute` takes a module path, so this file cannot be handed the
 * integration's options directly. It reads them from a virtual module the
 * integration registers instead — the standard way to get build-time
 * configuration into an injected entrypoint.
 *
 * The route is deliberately not prerendered: a prerendered API would be frozen
 * at build time, which is the opposite of the point.
 */

// @ts-expect-error - resolved at build time by the plugin the integration registers.
import { handler } from 'virtual:@laikacms/astro/api';

export const prerender = false;

export const ALL = ({ request }: { request: Request }): Promise<Response> =>
  (handler as (request: Request) => Promise<Response>)(request);
