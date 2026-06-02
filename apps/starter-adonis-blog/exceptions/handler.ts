import { ExceptionHandler } from '@adonisjs/core/http';
import type { HttpContext } from '@adonisjs/core/http';

export default class HttpExceptionHandler extends ExceptionHandler {
  async handle(error: unknown, ctx: HttpContext) {
    return super.handle(error, ctx);
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx);
  }
}
