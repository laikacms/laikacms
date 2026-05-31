import { defineNitroConfig } from 'nitropack/config';

export default defineNitroConfig({
  preset: 'node-server',
  publicAssets: [{ dir: 'public', baseURL: '/' }],
  srcDir: 'server',
});
