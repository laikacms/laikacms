export default defineNuxtConfig({
  nitro: {
    preset: 'cloudflare-pages',
  },
  routeRules: {
    '/admin': { ssr: false },
  },
});
