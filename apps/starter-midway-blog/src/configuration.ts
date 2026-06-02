import 'reflect-metadata';

import { App, Configuration } from '@midwayjs/core';
import * as koa from '@midwayjs/koa';

import { DecapMiddleware } from './middleware/decap.middleware.js';

@Configuration({
  // Only import koa — do NOT import @midwayjs/bodyparser.
  // bodyparser would consume request streams before our DecapMiddleware runs.
  // The Decap routes read the raw stream manually; blog routes use only path/query params.
  imports: [koa],
  importConfigs: [{ default: { koa: { port: Number(process.env.PORT ?? 3000) } } }],
})
export class MainConfiguration {
  @App('koa')
  app!: koa.Application;

  async onReady(): Promise<void> {
    // Register DecapMiddleware first so it intercepts /api/decap/* before
    // any other middleware (including any future bodyparser additions).
    this.app.useMiddleware([DecapMiddleware]);
  }
}
