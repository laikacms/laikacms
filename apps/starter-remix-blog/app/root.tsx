import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';

/**
 * Remix root layout — provides the HTML shell for every route.
 *
 * The admin route (/admin) opts out of the blog layout (<main> wrapper) by
 * living in the root group rather than the _blog layout group, so Decap CMS
 * can render into the full body without interference.
 */
export default function App() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}
