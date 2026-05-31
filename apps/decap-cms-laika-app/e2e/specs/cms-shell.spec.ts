import { expect, test } from '@playwright/test';

/**
 * Confirms the Decap admin shell at `/admin` actually mounts. The full
 * "create a post, publish, see it on /blog" round-trip needs `decap-server`
 * running alongside the Vite dev process (so `local_backend: true` has a
 * proxy to write through); wiring that into `webServer` is a follow-up
 * once we vendor `decap-server` into the workspace. For now this guards
 * the SPA boot path itself.
 */
test('admin route loads the SPA shell', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.locator('text=Loading the CMS').or(page.locator('text=Laika CMS'))).toBeVisible({
    timeout: 30_000,
  });
});
