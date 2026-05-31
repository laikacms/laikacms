import { Links, Meta, Outlet, Scripts, ScrollRestoration } from 'react-router';
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
export function Layout({ children }) {
  return (_jsxs('html', {
    lang: 'en',
    children: [
      _jsxs('head', {
        children: [
          _jsx('meta', { charSet: 'utf-8' }),
          _jsx('meta', { name: 'viewport', content: 'width=device-width, initial-scale=1' }),
          _jsx(Meta, {}),
          _jsx(Links, {}),
        ],
      }),
      _jsxs('body', { children: [children, _jsx(ScrollRestoration, {}), _jsx(Scripts, {})] }),
    ],
  }));
}
export default function App() {
  return _jsx(Outlet, {});
}
