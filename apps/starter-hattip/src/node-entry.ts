/**
 * Node.js runtime entry. Identical handler can be wired to other runtimes
 * by changing this one import — see README.
 */
import { createServer } from '@hattip/adapter-node';

import { handler } from './handler.js';

const PORT = Number(process.env.PORT ?? 3000);

createServer(handler).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`LaikaCMS Hattip backend listening on http://localhost:${PORT}`);
});
