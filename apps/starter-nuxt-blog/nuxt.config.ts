export default defineNuxtConfig({
  // The admin page is a pure client-side Decap CMS shell — disable SSR for it.
  routeRules: {
    '/admin': { ssr: false },
  },
});
