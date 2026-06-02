import { defineConfig } from '@adonisjs/core/app';

export default defineConfig({
  appKey: 'a-random-32-character-key-for-dev',
  http: {
    generateRequestId: true,
    allowMethodSpoofing: false,
    trustProxy: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  },
});
