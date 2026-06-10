import type { ReactNode } from 'react';

import { createPages } from 'waku';

import { laika } from './laika.js';
import BlogPostPage from './pages/blog/[slug].js';
import HomePage from './pages/index.js';

function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>My Blog · Turso</title>
        <style>
          {`
          body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
          a { color: #0070f3; }
        `}
        </style>
      </head>
      <body>{children}</body>
    </html>
  );
}

const ADMIN_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Content Manager</title>
    <script>window.CMS_MANUAL_INIT = true;</script>
  </head>
  <body>
    <script src="https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js"></script>
    <script src="/admin/bundle.js" type="module"></script>
  </body>
</html>`;

export default createPages(async ({ createPage, createLayout, createApi }) => {
  createApi({
    render: 'dynamic',
    path: '/api/decap/[...path]',
    handlers: { all: req => laika.fetch(req) },
  });

  createApi({
    render: 'dynamic',
    path: '/admin',
    handlers: {
      GET: async () => new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
    },
  });

  return [
    createLayout({
      render: 'dynamic',
      path: '/',
      component: RootLayout,
    }),
    createPage({
      render: 'dynamic',
      path: '/',
      component: HomePage,
    }),
    createPage({
      render: 'dynamic',
      path: '/blog/[slug]',
      component: BlogPostPage,
    }),
  ] as const;
});
