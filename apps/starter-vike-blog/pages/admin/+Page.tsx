import { useEffect } from 'react';

import { blogCollections } from '../../src/decap-config.js';

/**
 * Decap CMS admin UI.
 *
 * Pattern: "Decap admin from CDN" with useEffect bootstrap.
 *
 * Vike SSR renders null on the server (useEffect doesn't run in SSR).
 * On the client, useEffect bootstraps Decap which takes over the full
 * viewport via its own DOM manipulation.
 *
 * Note: Vike +data.ts files run server-only. This +Page.tsx component runs
 * on both server and client, so it must NOT import laika.ts (server-only).
 * The decap-config import is safe because it's pure data (no server APIs).
 */
export default function AdminPage() {
  useEffect(() => {
    (window as unknown as { CMS_MANUAL_INIT: boolean }).CMS_MANUAL_INIT = true;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    script.onload = async () => {
      const { default: createLaikaBackend } = await import(
        '@laikacms/decap-integrations/decap-cms-backend-laika'
      );
      const win = window as unknown as {
        CMS: {
          registerBackend: (name: string, backend: unknown) => void,
          init: (opts: unknown) => void,
        },
      };
      win.CMS.registerBackend('laika', createLaikaBackend());
      win.CMS.init({
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
