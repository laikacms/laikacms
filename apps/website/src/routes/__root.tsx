import { createRootRoute, HeadContent, Outlet } from '@tanstack/react-router';

import { Footer } from '../components/Footer';
import { Nav } from '../components/Nav';

export const Route = createRootRoute({
  // Fallback title; leaf routes override it via their own `head`. React 19
  // hoists this <title> from <HeadContent />, so the route title wins the tab.
  head: () => ({ meta: [{ title: 'Laika CMS: one content API, any backend' }] }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <div id="top">
      <HeadContent />
      <Nav />
      <main className="min-h-[60vh]">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
