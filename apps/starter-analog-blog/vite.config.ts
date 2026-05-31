import analog from '@analogjs/platform';
import { defineConfig } from 'vite';

export default defineConfig(() => ({
  publicDir: 'public',
  build: {
    target: ['es2020'],
  },
  resolve: {
    mainFields: ['module'],
  },
  plugins: [
    analog({
      ssr: true,
      nitro: {
        preset: 'node-server',
      },
    }),
  ],
}));
