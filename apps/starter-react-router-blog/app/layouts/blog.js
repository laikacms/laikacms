import { Link, Outlet } from 'react-router';
import { jsx as _jsx, jsxs as _jsxs } from 'react/jsx-runtime';
export default function BlogLayout() {
  return (_jsxs('div', {
    style: { maxWidth: '48rem', margin: '0 auto', padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' },
    children: [
      _jsxs('nav', {
        style: { marginBottom: '2rem' },
        children: [
          _jsx(Link, { to: '/', style: { fontWeight: 'bold', textDecoration: 'none' }, children: 'My Blog' }),
          ' · ',
          _jsx(Link, { to: '/admin', children: 'CMS' }),
        ],
      }),
      _jsx(Outlet, {}),
    ],
  }));
}
