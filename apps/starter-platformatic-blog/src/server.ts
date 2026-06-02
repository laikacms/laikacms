import Fastify from 'fastify';

import laikaPlugin from './plugins/laika.js';

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: true });

await app.register(laikaPlugin);

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
