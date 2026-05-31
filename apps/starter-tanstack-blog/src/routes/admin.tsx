import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { blogCollections } from '../decap-config.js';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

/**
 * Pattern: "Decap admin from CDN" with useEffect bootstrap.
 *
 * TanStack Start SSR renders null on the server (component returns null before
 * useEffect). On the client, useEffect bootstraps Decap CMS which takes over
 * the full viewport via its own DOM manipulation.
 *
 * Ordering guarantee:
 *   1. window.CMS_MANUAL_INIT = true is set synchronously in useEffect
 *   2. The CDN script is appended to <head>; its onload fires after it runs
 *   3. In onload we dynamically import the laika backend (bundled by Vite)
 *      and call CMS.init()
 */
function AdminPage() {
  useEffect(() => {
    (window as any).CMS_MANUAL_INIT = true;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    script.onload = async () => {
      const { default: createLaikaBackend } = await import(
        '@laikacms/decap-integrations/decap-cms-backend-laika'
      );
      (window as any).CMS.registerBackend('laika', createLaikaBackend());
      (window as any).CMS.init({
        config: {
          backend: { name: 'laika', api_url: '/api/decap' },
          media_folder: 'public/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      });
    };
    document.head.appendChild(script);
  }, []);

  return null;
}
