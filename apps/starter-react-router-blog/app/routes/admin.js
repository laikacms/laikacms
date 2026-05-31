import { useEffect } from 'react';
import { blogCollections } from '~/lib/decap-config';
export function meta() {
  return [{ title: 'Content Manager' }];
}
export default function Admin() {
  useEffect(() => {
    window.CMS_MANUAL_INIT = true;
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
    s.onload = async () => {
      const { default: createLaikaBackend } = await import('@laikacms/decap-integrations/decap-cms-backend-laika');
      const win = window;
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
    document.head.appendChild(s);
  }, []);
  return null;
}
