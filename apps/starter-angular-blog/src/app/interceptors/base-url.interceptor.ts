import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { SERVER_ORIGIN } from '../tokens';

/**
 * During SSR, Angular's HttpClient sends relative URLs but Node.js `fetch`
 * needs absolute URLs. This functional interceptor reads the SERVER_ORIGIN
 * token (injected by CommonEngine.render() in server.ts) and prepends the
 * server's origin to any relative URL.
 *
 * On the browser this interceptor is a no-op — SERVER_ORIGIN is never
 * provided on the client, so inject() returns null and the request passes
 * through unchanged.
 */
export const absoluteUrlInterceptor: HttpInterceptorFn = (req, next) => {
  const serverOrigin = inject(SERVER_ORIGIN, { optional: true });
  if (serverOrigin && req.url.startsWith('/')) {
    req = req.clone({ url: `${serverOrigin}${req.url}` });
  }
  return next(req);
};
