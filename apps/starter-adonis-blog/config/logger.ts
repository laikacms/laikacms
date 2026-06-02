import { defineConfig } from '@adonisjs/core/logger';

export default defineConfig({
  default: 'app',
  loggers: {
    app: {
      enabled: true,
      name: 'starter-adonis-blog',
      level: process.env.LOG_LEVEL ?? 'info',
      transport: {
        targets: [{ target: 'pino-pretty', options: {}, level: 'info' }],
      },
    },
  },
});
