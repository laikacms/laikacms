import { defineEventHandler, toWebRequest } from 'h3';

import { laika } from '../../../utils/laika.js';

/*
 * Doc gap: toWebRequest(event) converts the H3 event to a standard WHATWG
 * Request including URL, method, headers, and body. Nitro/H3 supports
 * returning a WHATWG Response directly from defineEventHandler — no need
 * to call sendWebResponse or manually set status/headers.
 *
 * Doc gap: defineEventHandler, getRouterParam, etc. are Nitro auto-imports
 * during the build — they come from h3. For plain tsc typechecking outside
 * the Nitro build context you must import them explicitly.
 */
export default defineEventHandler(event => laika.fetch(toWebRequest(event)));
