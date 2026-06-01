import { InjectionToken } from '@angular/core';

/**
 * The origin of the server (e.g. `http://localhost:3000`). Injected by
 * CommonEngine.render() so that the base-URL interceptor can prepend it to
 * relative HttpClient URLs during server-side rendering.
 *
 * On the browser side this token is never provided, so `inject(SERVER_ORIGIN,
 * { optional: true })` returns null and the interceptor is a no-op.
 */
export const SERVER_ORIGIN = new InjectionToken<string>('SERVER_ORIGIN');
