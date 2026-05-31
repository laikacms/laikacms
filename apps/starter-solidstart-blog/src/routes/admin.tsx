import { onMount } from 'solid-js';

import { blogCollections } from '~/lib/decap-config.js';

/**
 * Decap CMS admin — client-only bootstrap.
 *
 * SolidStart SSRs every route by default. For Decap, SSR renders nothing
 * (the component returns null) and onMount bootstraps Decap on the client.
 *
 * Ordering guarantee:
 *   1. window.CMS_MANUAL_INIT = true is set before the CDN script loads.
 *   2. The CDN <script> is appended; its onload fires after the parser-blocking
 *      script runs, so window.CMS is already defined.
 *   3. In onload we dynamically import the laika backend (tree-shaken by Vite)
 *      and call CMS.init().
 */
export default function Admin() {
  onMount(async () => {
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
          media_folder: 'public/uploads',
          public_folder: '/uploads',
          collections: blogCollections,
        },
      });
    };
    document.head.appendChild(script);
  });

  return null;
}
