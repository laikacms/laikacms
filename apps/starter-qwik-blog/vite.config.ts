import { qwikCity } from '@builder.io/qwik-city/vite';
import { qwikVite } from '@builder.io/qwik/optimizer';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [qwikCity(), qwikVite()],
  preview: { headers: { 'Cache-Control': 'public, max-age=600' } },
  ssr: {
    external: ['laikacms', '@laikacms/decap-integrations'],
  },
});
