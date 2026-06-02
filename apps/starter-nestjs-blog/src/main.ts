import 'reflect-metadata';

import { join } from 'node:path';

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';

const PORT = Number(process.env.PORT ?? 3000);

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve public/ (admin UI bundle + uploads) as static files.
  // public/admin/index.html  → /admin/
  // public/admin/bundle.js   → /admin/bundle.js
  // public/uploads/*         → /uploads/*
  app.useStaticAssets(join(process.cwd(), 'public'));

  await app.listen(PORT);
  console.log(`NestJS blog running at http://localhost:${PORT}`);
  console.log(`  Blog:  http://localhost:${PORT}/`);
  console.log(`  Admin: http://localhost:${PORT}/admin/`);
}

bootstrap();
