import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import { laika } from '@laikacms/astro';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://laikacms.com',
  integrations: [laika({ dir: 'content', defaultExtension: 'yaml' }), mdx(), react()],
  server: { port: 3300 },
  build: { format: 'directory' },
  vite: {
    plugins: [tailwindcss()],
  },
});
