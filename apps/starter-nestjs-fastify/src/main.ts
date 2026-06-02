import 'reflect-metadata';

import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.js';

/**
 * NestJS application using the Fastify adapter.
 *
 * Key differences from starter-nestjs-blog (NestExpressApplication):
 *   1. FastifyAdapter replaces the default Express adapter.
 *   2. @fastify/static serves public/ (for media uploads, etc.).
 *   3. blog controller uses FastifyReply instead of ExpressRes.
 *   4. Decap proxy uses JSON re-serialization (see laika-request.util.ts)
 *      because Fastify pre-parses request bodies before handlers run.
 */
const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // Serve public/ (media uploads) as static files.
  await app.register(
    (await import('@fastify/static')).default,
    {
      root: join(process.cwd(), 'public'),
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    },
  );

  await app.listen({ port: PORT, host: '0.0.0.0' });
  // eslint-disable-next-line no-console
  console.log(`NestJS/Fastify blog running at http://localhost:${PORT}`);
  // eslint-disable-next-line no-console
  console.log(`  Blog:  http://localhost:${PORT}/`);
  // eslint-disable-next-line no-console
  console.log(`  Admin: http://localhost:${PORT}/admin`);
}

bootstrap();
