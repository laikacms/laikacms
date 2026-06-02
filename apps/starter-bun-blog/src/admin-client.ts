import createLaikaBackend from '@laikacms/decap-integrations/decap-cms-backend-laika';

import { blogCollections } from './decap-config.js';

(window as unknown as { CMS_MANUAL_INIT: boolean }).CMS_MANUAL_INIT = true;

const script = document.createElement('script');
script.src = 'https://unpkg.com/decap-cms@^3.0.0/dist/decap-cms.js';
script.onload = () => {
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
