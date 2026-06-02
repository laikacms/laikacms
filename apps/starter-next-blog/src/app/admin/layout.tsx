import type { ReactNode } from 'react';

/**
 * The admin layout strips the root layout (nav, padding) so Decap CMS
 * can take over the full viewport.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body style={{ margin: 0 }}>
        {children}
      </body>
    </html>
  );
}
