import { Links, Meta, Outlet, Scripts, ScrollRestoration } from '@remix-run/react';
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
/**
 * Remix root layout — provides the HTML shell for every route.
 *
 * The admin route (/admin) opts out of the blog layout (<main> wrapper) by
 * living in the root group rather than the _blog layout group, so Decap CMS
 * can render into the full body without interference.
 */
export default function App() {
  return (_jsxs('html', {
    lang: 'en',
    children: [
      _jsxs('head', {
        children: [
          _jsx('meta', { charSet: 'utf-8' }),
          _jsx('meta', { name: 'viewport', content: 'width=device-width,initial-scale=1' }),
          _jsx(Meta, {}),
          _jsx(Links, {}),
        ],
      }),
      _jsxs('body', { children: [_jsx(Outlet, {}), _jsx(ScrollRestoration, {}), _jsx(Scripts, {})] }),
    ],
  }));
}
