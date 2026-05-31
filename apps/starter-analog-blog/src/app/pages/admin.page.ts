import { type RouteMeta } from '@analogjs/router';
import { afterNextRender, Component } from '@angular/core';

import { blogCollections } from '../../lib/decap-config.js';

export const routeMeta: RouteMeta = {
  title: 'Content Manager',
};

/**
 * Decap CMS admin — bootstrapped on the client via afterNextRender.
 *
 * afterNextRender (Angular 18+) runs after the next render cycle, but only
 * in the browser. It is the Angular equivalent of React's useEffect(() => {}, [])
 * for client-only side effects.
 *
 * Unlike React's useEffect or Qwik's useVisibleTask$, afterNextRender is NOT
 * a hook — it's a function called during injection context (typically in the
 * constructor). It CANNOT be called conditionally or inside lifecycle methods.
 *
 * Doc gap: Decap needs `window.CMS_MANUAL_INIT = true` set BEFORE the CDN
 * script executes. Since afterNextRender fires after the first render, we set
 * it synchronously before appending the script tag — both steps happen in the
 * same afterNextRender callback, so the ordering is guaranteed.
 */
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
