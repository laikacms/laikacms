import { defineConfig } from '@adonisjs/core/app';

export default defineConfig({
  typescript: true,
  directories: {
    public: 'public',
    views: 'resources/views',
    config: 'config',
    commands: 'commands',
    controllers: 'app/controllers',
    middleware: 'app/middleware',
    providers: 'providers',
  },
  providers: [
    () => import('./providers/app_provider.js'),
  ],
});
