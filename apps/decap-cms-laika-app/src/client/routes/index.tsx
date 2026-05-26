import { createFileRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export const Route = createFileRoute('/')({
  component: Landing,
});

function Landing(): ReactNode {
  return (
    <div style={{ maxWidth: 760, margin: '64px auto', padding: '0 24px', lineHeight: 1.55 }}>
      <h1 style={{ fontSize: 32, margin: '0 0 12px' }}>Laika CMS</h1>
      <p style={{ color: '#475569' }}>
        Decap CMS v4.beta wrapped in a Vite + TanStack shell, deployed as a Cloudflare Worker. The two custom rich-text
        widgets (Lexical-backed and{' '}
        <code>@portabletext/editor</code>-backed) are pre-registered and share the same 68-strong mapper catalogue.
      </p>
      <p>
        <Link
          to="/admin"
          style={{
            display: 'inline-block',
            marginTop: 12,
            padding: '8px 14px',
            background: '#0f172a',
            color: '#fff',
            borderRadius: 6,
            textDecoration: 'none',
          }}
        >
          Open the CMS →
        </Link>
      </p>
      <h2 style={{ marginTop: 48, fontSize: 20 }}>What's bundled</h2>
      <ul>
        <li>Decap CMS v4.beta core</li>
        <li>
          <code>decap-cms-widget-lexicaleditor</code> — Lexical-based editor (shadcn-editor port)
        </li>
        <li>
          <code>decap-cms-widget-portabletext-editor</code> — Sanity's <code>@portabletext/editor</code>
        </li>
        <li>
          68 <code>portable-text-to-*-mapper</code> packages registered globally
        </li>
      </ul>
    </div>
  );
}
