import { createFileRoute } from '@tanstack/react-router';
import { useEffect } from 'react';

import { blogCollections } from '../decap-config.js';

export const Route = createFileRoute('/admin')({
  component: AdminPage,
});

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
