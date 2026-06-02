import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'My Blog',
  description: 'A blog powered by LaikaCMS',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          maxWidth: 720,
          margin: '0 auto',
          padding: '2rem 1rem',
          lineHeight: 1.6,
          color: '#1a1a1a',
        }}
      >
        <nav style={{ marginBottom: '2rem' }}>
          <a href="/" style={{ marginRight: '1rem', color: 'inherit' }}>Blog</a>
          <a href="/admin" style={{ color: 'inherit' }}>Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}
