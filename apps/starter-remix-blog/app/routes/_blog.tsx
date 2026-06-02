import { Outlet } from '@remix-run/react';

/**
 * Layout route for blog pages (/ and /blog/:slug).
 *
 * Routes that use this layout have filenames starting with "_blog.".
 * The admin route does NOT use this layout, so Decap CMS gets a clean body.
 */
export default function BlogLayout() {
  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <Outlet />
    </main>
  );
}
