import type { RequestHandler } from '@builder.io/qwik-city';

import { laika } from '~/server/laika';

// Qwik gives us request.request which is a web-standard Request. Forward
// every method through laika.fetch and send the response back via
// requestEvent.send.
const handler: RequestHandler = async ({ request, send }) => {
  const response = await laika.fetch(request);
  send(response);
};

export const onGet = handler;
export const onPost = handler;
export const onPut = handler;
export const onPatch = handler;
export const onDelete = handler;
export const onOptions = handler;
