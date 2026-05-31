import { component$, useVisibleTask$ } from '@builder.io/qwik';
import type { DocumentHead } from '@builder.io/qwik-city';

import { blogCollections } from '~/lib/decap-config';

export const head: DocumentHead = { title: 'Content Manager' };

/**
 * Decap CMS admin UI — Qwik City version of the "Decap admin from CDN" pattern.
 *
 * useVisibleTask$ is the Qwik equivalent of React's useEffect — it runs only
 * in the browser after the component becomes visible. SSR renders null.
 *
 * Initialization order:
 *   1. window.CMS_MANUAL_INIT = true — set before the CDN script loads
 *   2. decap-cms.js loaded from CDN (sets window.CMS)
 *   3. laika backend dynamically imported (bundled by Vite)
 *   4. CMS.registerBackend + CMS.init with inline config
 */
export default component$(() => {
  useVisibleTask$(async () => {
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
  });

  return null;
});
