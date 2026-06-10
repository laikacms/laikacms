import { defineEventHandler, sendWebResponse, toWebRequest } from 'h3';

import { laika } from '../../../../lib/laika.js';

export default defineEventHandler(async event => {
  const request = toWebRequest(event);
  const response = await laika.fetch(request);
  return sendWebResponse(event, response);
});
