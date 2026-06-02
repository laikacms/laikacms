import type { AppProps } from 'next/app';
import Link from 'next/link';

export default function App({ Component, pageProps }: AppProps) {
  return (
    <div
      style={{
        fontFamily: 'system-ui, sans-serif',
        maxWidth: 720,
        margin: '0 auto',
        padding: '2rem 1rem',
        lineHeight: 1.6,
      }}
    >
      <header style={{ marginBottom: '2rem' }}>
        <Link href="/" style={{ textDecoration: 'none', color: 'inherit' }}>
          <h1 style={{ margin: 0 }}>LaikaCMS blog</h1>
        </Link>
        <nav style={{ marginTop: '0.5rem' }}>
          <Link href="/" style={{ marginRight: '1rem' }}>Home</Link>
          <Link href="/admin">Admin</Link>
        </nav>
      </header>
      <main>
        <Component {...pageProps} />
      </main>
    </div>
  );
}
