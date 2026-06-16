import { defineNitroConfig } from 'nitropack/config';

export default defineNitroConfig({
  compatibilityDate: '2026-06-16',
  preset: 'node-server',
  publicAssets: [{ dir: 'public', baseURL: '/' }],
  srcDir: 'server',
});
