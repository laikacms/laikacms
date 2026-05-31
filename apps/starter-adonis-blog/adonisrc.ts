import { defineConfig } from '@adonisjs/core/app';

export default defineConfig({
  typescript: true,

  /*
   * AdonisJS executes preload files before starting the HTTP server.
   * routes.ts registers all URL routes on the AdonisJS router.
   */
  preloads: [
    () => import('#start/routes'),
  ],

  /*
   * Providers register bindings and boot services. The app_provider handles
   * core IoC container bindings; static_provider serves /public/*.
   */
  providers: [
    () => import('@adonisjs/core/providers/app_provider'),
    () => import('@adonisjs/core/providers/hash_provider'),
    () => import('@adonisjs/static/static_provider'),
  ],
});
