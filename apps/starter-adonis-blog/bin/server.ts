/**
 * AdonisJS entry point — starts the HTTP server.
 *
 * Development:  node ace serve --watch
 * Production:   node bin/server.js  (after: node ace build)
 */
import 'reflect-metadata';

import { Ignitor } from '@adonisjs/core';

const APP_ROOT = new URL('../', import.meta.url);
const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href);
  }
  return import(filePath);
};

await new Ignitor(APP_ROOT, { importer: IMPORTER }).httpServer().start();
