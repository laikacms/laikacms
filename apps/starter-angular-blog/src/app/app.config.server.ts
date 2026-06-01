import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, mergeApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

import { appConfig } from './app.config';
import { absoluteUrlInterceptor } from './interceptors/base-url.interceptor';

/**
 * Server-side application config. Merged with appConfig and used only during
 * SSR (bootstrapped from src/main.server.ts → server.ts).
 *
 * Differences from appConfig:
 *   1. provideServerRendering() enables Angular Universal SSR.
 *   2. provideHttpClient is overridden to add absoluteUrlInterceptor, which
 *      converts relative URLs to absolute so Node.js fetch can resolve them.
 *      The interceptor is a no-op in the browser where SERVER_ORIGIN is absent.
 */
const serverConfig: ApplicationConfig = {
  providers: [
    provideServerRendering(),
    provideHttpClient(withFetch(), withInterceptors([absoluteUrlInterceptor])),
  ],
};

export const config = mergeApplicationConfig(appConfig, serverConfig);
