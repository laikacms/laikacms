/**
 * Doc gap (Midway.js standalone bootstrap without CLI):
 *
 * The Midway.js CLI (`midway dev`) handles framework initialization and file
 * scanning.  For a standalone tsx script we use `Framework` from @midwayjs/koa
 * directly.
 *
 * Key steps:
 * 1. `framework.initialize({ appDir })` — scans src/ for @Controller /
 *    @Provide / @Middleware decorated classes
 * 2. `framework.run()` — starts the Koa HTTP server on the configured port
 *
 * The `appDir` should be the PROJECT ROOT (parent of src/).  Midway.js looks
 * for files in <appDir>/src/ when the process is running from source.
 */

import 'reflect-metadata';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MidwayContainer } from '@midwayjs/core';
import { Framework } from '@midwayjs/koa';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

// Framework requires a pre-built IoC container.  MidwayContainer is the
// concrete implementation of IMidwayGlobalContainer used in standalone mode.
const container = new MidwayContainer();
const framework = new Framework(container);
await framework.initialize({
  appDir: resolve(__dirname, '..'), // project root (parent of src/)
  globalConfig: {
    koa: { port: PORT },
  },
});
await framework.run();

console.log(`Midway.js + LaikaCMS running at http://localhost:${PORT}`);
console.log(`  Blog:  http://localhost:${PORT}/`);
console.log(`  Admin: http://localhost:${PORT}/admin`);
