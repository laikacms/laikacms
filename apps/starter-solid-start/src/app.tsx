import { Router } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Suspense } from 'solid-js';

export default function App() {
  return (
    <Router
      root={props => (
        <>
          <header style="margin-bottom: 2rem;">
            <a href="/" style="text-decoration: none; color: inherit;">
              <h1 style="margin: 0;">LaikaCMS blog</h1>
            </a>
            <nav style="margin-top: 0.5rem;">
              <a href="/" style="margin-right: 1rem;">Home</a>
              <a href="/admin">Admin</a>
            </nav>
          </header>
          <main>
            <Suspense>{props.children}</Suspense>
          </main>
        </>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
