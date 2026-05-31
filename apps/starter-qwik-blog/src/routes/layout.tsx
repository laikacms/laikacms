import { component$, Slot } from '@builder.io/qwik';
import { Link } from '@builder.io/qwik-city';

export default component$(() => (
  <>
    <header style="margin-bottom: 2rem;">
      <Link href="/" style="text-decoration: none; color: inherit;">
        <h1 style="margin: 0;">LaikaCMS blog</h1>
      </Link>
      <nav style="margin-top: 0.5rem;">
        <Link href="/" style="margin-right: 1rem;">Home</Link>
        <a href="/admin.html">Admin</a>
      </nav>
    </header>
    <main>
      <Slot />
    </main>
  </>
));
