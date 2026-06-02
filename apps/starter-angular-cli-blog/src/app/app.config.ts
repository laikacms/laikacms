import { provideHttpClient, withFetch } from '@angular/common/http';
import type { ApplicationConfig } from '@angular/core';
import { provideZoneChangeDetection } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes.js';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    /**
     * withFetch() enables Angular's HttpClient to use the global fetch API
     * instead of XHR. Required for SSR: during server-side rendering Angular
     * makes HTTP requests back to the Express server (e.g. GET /api/posts),
     * and only the fetch-based client works in that context.
     */
    provideHttpClient(withFetch()),
    provideClientHydration(withEventReplay()),
  ],
};
