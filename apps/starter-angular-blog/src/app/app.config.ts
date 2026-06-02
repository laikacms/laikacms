import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideClientHydration, withHttpTransferCache } from '@angular/platform-browser';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { routes } from './app.routes.js';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // withFetch() uses the global fetch API (works in both browser and Node.js).
    // withHttpTransferCache() serialises HTTP responses made during SSR so the
    // browser can replay them without an extra round-trip.
    provideHttpClient(withFetch()),
    provideClientHydration(withHttpTransferCache()),
  ],
};
