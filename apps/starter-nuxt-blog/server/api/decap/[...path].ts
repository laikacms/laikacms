import { toWebRequest } from 'h3';

import { laika } from '../../utils/laika';

/**
 * Proxy every HTTP method to the embedded Laika/Decap JSON:API handler.
 *
 * toWebRequest(event) converts the Nitro/H3 event to a standard Web API Request
 * so laika.fetch receives the full URL, headers, and body. Nitro supports returning
 * a Response object directly from a defineEventHandler.
 */
export default defineEventHandler(event => laika.fetch(toWebRequest(event)));
