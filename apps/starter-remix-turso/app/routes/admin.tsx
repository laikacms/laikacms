import type { MetaFunction } from '@remix-run/node';
import { useEffect } from 'react';

import { blogCollections } from '~/lib/decap-config';

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
