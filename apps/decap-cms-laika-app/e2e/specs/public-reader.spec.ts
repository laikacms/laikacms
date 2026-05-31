import { expect, test } from '@playwright/test';

/**
 * Public-reader smoke. Verifies the worker route serves rendered post
 * content from `content/posts/` end-to-end — the same path Decap CMS
 * commits writes to in local-backend mode. If this regresses, the
 * "author in /admin → see it on /blog" round-trip is broken at the
 * delivery side regardless of whether the CMS itself is healthy.
 */
test.describe('public reader', () => {
  test('landing page lists the seed post', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Laika CMS Demo', level: 1 })).toBeVisible();
    await expect(page.getByTestId('post-link').first()).toHaveText(/Welcome to the demo/);
  });

  test('blog index shows the seed post', async ({ page }) => {
    await page.goto('/blog');
    await expect(page.getByTestId('blog-heading')).toBeVisible();
    await expect(page.getByTestId('blog-list')).toContainText('Welcome to the demo');
  });

  test('clicking a post lands on /blog/:slug with the body rendered', async ({ page }) => {
    await page.goto('/blog');
    await page.getByTestId('post-link').first().click();
    await expect(page).toHaveURL(/\/blog\/2026-01-01-welcome$/);
    await expect(page.getByTestId('post-title')).toHaveText('Welcome to the demo');
    await expect(page.getByTestId('post-body')).toContainText(
      'rendered by the Cloudflare Worker',
    );
  });

  test('unknown slugs return 404', async ({ request }) => {
    const res = await request.get('/blog/does-not-exist');
    expect(res.status()).toBe(404);
  });
});
