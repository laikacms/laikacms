import { useEffect } from 'react';

import { blogCollections } from '../lib/decap-config.js';

/**
 * Decap CMS admin — bootstrapped on the client via useEffect.
 *
 * Gatsby pre-renders this page as a static HTML shell (returns null during
 * SSG). In the browser, useEffect bootstraps Decap CMS which takes over the
 * full viewport via its own DOM manipulation.
 *
 * Doc gap: Gatsby SSG renders ALL pages at build time, including this one.
 * The component returns null so the page is just an empty HTML shell.
 * Any code that references browser globals (window, document) must be inside
 * useEffect or guarded with `typeof window !== 'undefined'`.
 */
export default function AdminPage() {
  useEffect(() => {
    (window as unknown as Record<string, unknown>)['CMS_MANUAL_INIT'] = true;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    script.onload = async () => {
      const cms = (window as unknown as Record<string, unknown>)['CMS'] as {
        registerBackend: (name: string, backend: unknown) => void,
        init: (options: unknown) => void,
      };
      const { default: createLaikaBackend } = await import(
        '@laikacms/decap-integrations/decap-cms-backend-laika'
      );
      cms.registerBackend('laika', createLaikaBackend());
      cms.init({
        config: {
          backend: { name: 'laika', api_url: '/api/decap' },
          media_folder: 'static/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      });
    };
    document.head.appendChild(script);
  }, []);

  return null;
}
