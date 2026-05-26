import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { routeTree } from './routeTree.gen';

/**
 * SPA bootstrap.
 *
 * The shell uses TanStack Router (file-based routes under `routes/`) for
 * non-CMS pages and TanStack Query for any data fetching from the worker.
 * Decap CMS itself is loaded lazily on the `/admin` route (see
 * `routes/admin.tsx`), so the landing page stays a thin SPA bundle and the
 * heavy `decap-cms` bundle is only pulled when an editor visits the admin.
 */
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('decap-cms-laika-app: #root element missing in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
