import { defineConfig } from '@adonisjs/core/http';

export default defineConfig({
  generateRequestId: false,
  trustProxy: false,
  cookie: {},
  allowMethodSpoofing: false,
});
