import { createRootRoute, Outlet } from '@tanstack/react-router';

import { Footer } from '../components/Footer';
import { Nav } from '../components/Nav';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <div id="top">
      <Nav />
      <main className="min-h-[60vh]">
        <Outlet />
      </main>
      <Footer />
    </div>
  );
}
