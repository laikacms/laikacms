import type { RequestContext } from 'brisa';

import { laika } from '../../../lib/laika.ts';

// Brisa's RequestContext extends the WHATWG Fetch API Request interface, so
// laika.fetch(req) works with zero adaptation — no bridging needed.
export default function decapProxy(req: RequestContext): Promise<Response> {
  return laika.fetch(req);
}
