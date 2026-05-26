import type { QueryClient } from '@tanstack/react-query';
import { createRootRouteWithContext, Link, Outlet } from '@tanstack/react-router';
import type { ReactNode } from 'react';

interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout(): ReactNode {
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 24px',
          display: 'flex',
          gap: 16,
          alignItems: 'baseline',
        }}
      >
        <strong style={{ fontSize: 17 }}>Laika CMS</strong>
        <nav style={{ display: 'flex', gap: 12, fontSize: 14 }}>
          <Link to="/" activeOptions={{ exact: true }} style={navStyle} activeProps={activeNavProps}>
            Home
          </Link>
          <Link to="/admin" style={navStyle} activeProps={activeNavProps}>
            Admin
          </Link>
        </nav>
      </header>
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
    </div>
  );
}

const navStyle: React.CSSProperties = { color: '#374151', textDecoration: 'none' };
const activeNavProps = { style: { color: '#0f172a', fontWeight: 600 } };
