import { Outlet } from '@remix-run/react';

export default function BlogLayout() {
  return (
    <main style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1rem', fontFamily: 'sans-serif' }}>
      <Outlet />
    </main>
  );
}
