import node from '@astrojs/node';
import { defineConfig } from 'astro/config';

// output: 'static' — blog pages are prerendered at build time using the
// Content Layer. Admin routes (prerender = false) stay SSR so the Decap
// JSON:API is live even after a static build.
export default defineConfig({
  output: 'static',
  adapter: node({ mode: 'standalone' }),
});
