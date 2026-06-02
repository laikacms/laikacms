import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';

import { laika } from '~/lib/laika.server';

/**
 * Proxy every HTTP method to the embedded Laika/Decap JSON:API handler.
 *
 * React Router v7 passes the WHATWG Request in both loader (GET/HEAD) and
 * action (POST/PUT/DELETE/PATCH), so laika.fetch receives the full URL,
 * headers, and body without any wrapping.
 *
 * No default export — this is a resource route (API-only, no UI).
 */
export function loader({ request }: LoaderFunctionArgs) {
  return laika.fetch(request);
}

export function action({ request }: ActionFunctionArgs) {
  return laika.fetch(request);
}
