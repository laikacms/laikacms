import { laikacms } from '@laikacms/vite-plugin';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  vite: {
    build: { cssMinify: 'esbuild' },
    plugins: [laikacms({ dir: 'content', defaultExtension: 'md', localApi: true })],
  },
});
