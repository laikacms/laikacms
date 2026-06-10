'use client';

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
