import type { MetaFunction } from '@remix-run/node';
import { useEffect } from 'react';

import { blogCollections } from '~/lib/decap-config';

/**
 * Decap CMS admin UI — Remix version of the "Decap admin from CDN" pattern.
 *
 * No layout wrapper from _blog.tsx applies here (different route group),
 * so Decap CMS renders unobstructed into the full document body.
 *
 * Initialization order in useEffect (browser only):
 *   1. window.CMS_MANUAL_INIT = true — must be set before the CDN script loads.
 *   2. decap-cms.js loaded from CDN dynamically (sets window.CMS).
 *   3. laika backend imported from @laikacms/decap-integrations (bundled by Vite).
 *   4. CMS.registerBackend + CMS.init with inline config.
 *
 * useEffect does not run during SSR, so the server renders an empty body for
 * this route — Decap CMS fully owns the page on the client.
 */
export const meta: MetaFunction = () => [{ title: 'Content Manager' }];

export default function Admin() {
  useEffect(() => {
    (window as any).CMS_MANUAL_INIT = true;

    const s = document.createElement('script');
    s.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    s.onload = async () => {
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

    document.head.appendChild(s);
  }, []);

  return null;
}
