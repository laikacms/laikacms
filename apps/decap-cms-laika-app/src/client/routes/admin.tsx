import { createFileRoute } from '@tanstack/react-router';
import { lazy, type ReactNode, Suspense } from 'react';

const DecapAdmin = lazy(async () => {
  const m = await import('../DecapApp');
  return { default: m.DecapAdmin };
});

export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

/**
 * `/admin` mounts the self-bootstrapped Decap CMS app as a child component
 * of our TanStack route tree. The lazy import keeps the (large) Decap
 * bundle out of the SPA entry chunk.
 */
function AdminPage(): ReactNode {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <DecapAdmin />
    </Suspense>
  );
}

function LoadingFallback(): ReactNode {
  return (
    <div style={{ padding: '48px 24px', color: '#475569', fontFamily: 'system-ui, sans-serif' }}>
      Loading the CMS…
    </div>
  );
}
