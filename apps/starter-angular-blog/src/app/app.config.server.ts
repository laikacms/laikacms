import { ApplicationConfig } from '@angular/core';
import { provideServerRendering } from '@angular/platform-server';

// SERVER_URL is injected by server.ts at render time (e.g. "http://localhost:4000").
// PostsService uses it to construct absolute URLs for server-side HttpClient calls.
// On the browser, the token is absent and PostsService falls back to relative URLs.
export const serverConfig: ApplicationConfig = {
  providers: [provideServerRendering()],
};
