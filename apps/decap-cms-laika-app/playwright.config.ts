import { defineConfig, devices } from '@playwright/test';

/**
 * E2e config for the Laika CMS demo. We boot `vite dev` (which hosts both the
 * SPA bundle and the Hono worker via `@cloudflare/vite-plugin`) and run the
 * browser specs against it. Decap's admin UI under `/admin` and the public
 * `/`, `/blog`, `/blog/:slug` reader share the same origin, so a single base
 * URL covers both ends of the round-trip.
 *
 * Set `VITE_DECAP_LOCAL=true` so the SPA flips Decap into `local_backend`
 * mode — the admin UI would otherwise try to OAuth against GitHub during the
 * smoke spec.
 */
export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:3200',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3200/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { VITE_DECAP_LOCAL: 'true' },
  },
});
