import { type RouteMeta } from '@analogjs/router';
import { afterNextRender, Component } from '@angular/core';

import { blogCollections } from '../../lib/decap-config.js';

export const routeMeta: RouteMeta = {
  title: 'Content Manager',
};

@Component({
  selector: 'app-admin',
  standalone: true,
  template: '',
})
export default class AdminPageComponent {
  constructor() {
    afterNextRender(() => {
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
  }
}
