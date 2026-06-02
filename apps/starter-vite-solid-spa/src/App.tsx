import { A } from '@solidjs/router';
import type { ParentProps } from 'solid-js';

export function App(props: ParentProps) {
  return (
    <>
      <header style="margin-bottom: 2rem;">
        <A href="/" style="text-decoration: none; color: inherit;">
          <h1 style="margin: 0;">LaikaCMS blog</h1>
        </A>
        <nav style="margin-top: 0.5rem;">
          <A href="/" style="margin-right: 1rem;">Home</A>
          <a href="/admin">Admin</a>
        </nav>
      </header>
      <main>{props.children}</main>
    </>
  );
}
