import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { laikacms } from '@laikacms/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://laikacms.com',
  integrations: [mdx(), react()],
  server: { port: 3300 },
  build: { format: 'directory' },
  vite: {
    plugins: [
      laikacms({ dir: 'src/content', defaultExtension: 'yaml', mdx: true }),
      tailwindcss(),
    ],
  },
});
