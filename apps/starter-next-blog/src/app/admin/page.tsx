'use client';

/**
 * Decap CMS admin page.
 *
 * Next.js renders this as a client component. On mount, it dynamically imports
 * the laika backend plugin (tree-shaken by webpack), registers it with Decap,
 * and calls CMS.init() with the inline config.
 *
 * Decap CMS itself is loaded from CDN via a <script> tag injected by useEffect
 * so it is never bundled into the Next.js chunk.
 */
import { useEffect } from 'react';

import { blogCollections } from '@/lib/decap-config';

type WindowWithCMS = Window & {
  CMS_MANUAL_INIT: boolean,
  CMS: {
    registerBackend: (name: string, backend: unknown) => void,
    init: (opts: Record<string, unknown>) => void,
  },
};

export default function AdminPage() {
  useEffect(() => {
    const win = window as unknown as WindowWithCMS;
    // Prevent Decap from auto-initialising before the laika backend is ready.
    win.CMS_MANUAL_INIT = true;

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    script.onload = async () => {
      const { default: createLaikaBackend } = await import(
        '@laikacms/decap-integrations/decap-cms-backend-laika'
      );

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
