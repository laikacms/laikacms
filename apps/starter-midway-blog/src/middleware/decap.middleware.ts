/**
 * Decap API proxy middleware.
 *
 * Doc gap (Midway.js body-parser bypass):
 *
 * Midway.js v4 with the Koa adapter registers @midwayjs/bodyparser (if imported)
 * BEFORE custom middleware, consuming the request stream before controllers run.
 * To forward raw bodies to laika.fetch, we add a Koa middleware that intercepts
 * /api/decap/* routes and reads the stream manually — without @midwayjs/bodyparser.
 *
 * Midway.js middleware runs in declaration order; registering this middleware
 * first (before any bodyparser) keeps the stream pristine.
 *
 * @Middleware() marks this class for auto-discovery by Midway's IoC container.
 * The static `getName()` method gives it a stable identifier.
 */

import { IMiddleware, Middleware } from '@midwayjs/core';
import { Inject } from '@midwayjs/core';
import type { Context, NextFunction } from '@midwayjs/koa';

import { LaikaService } from '../service/laika.service.js';

@Middleware()
export class DecapMiddleware implements IMiddleware<Context, NextFunction> {
  @Inject()
  laikaService!: LaikaService;

  static getName(): string {
    return 'decap';
  }

  resolve() {
    return async (ctx: Context, next: NextFunction) => {
      if (!ctx.path.startsWith('/api/decap')) {
        return next();
      }

      // Read raw body stream before any Midway/Koa body parser could run.
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        ctx.req.on('data', (chunk: Buffer) => chunks.push(chunk));
        ctx.req.on('end', resolve);
        ctx.req.on('error', reject);
      });
      const rawBody = Buffer.concat(chunks);

      const method = ctx.method.toUpperCase();
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const rawBuf = hasBody && rawBody.length > 0 ? rawBody : undefined;
      const body: ArrayBuffer | null = rawBuf
        ? (rawBuf.buffer.slice(rawBuf.byteOffset, rawBuf.byteOffset + rawBuf.byteLength) as ArrayBuffer)
        : null;

      // Reconstruct full URL from Koa context (ctx.href includes host + path + query)
      const webReq = new Request(ctx.href, {
        method,
        headers: ctx.req.headers as Record<string, string>,
        body,
      });

      const webRes = await this.laikaService.laika.fetch(webReq);

      ctx.status = webRes.status;
      webRes.headers.forEach((value: string, name: string) => {
        if (name.toLowerCase() !== 'transfer-encoding') ctx.set(name, value);
      });
      ctx.body = Buffer.from(await webRes.arrayBuffer());
    };
  }
}
