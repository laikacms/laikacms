import { afterNextRender, Component } from '@angular/core';

import { blogCollections } from '../../lib/decap-config.js';

/**
 * Decap CMS admin — bootstrapped on the client via afterNextRender.
 *
 * afterNextRender (Angular 18+) runs after the first render cycle, but only
 * in the browser. It is the Angular equivalent of React's useEffect(() => {}, []).
 *
 * Doc gap: `afterNextRender` CANNOT be called conditionally or in lifecycle
 * methods — it must be called synchronously in the constructor (during the
 * injection context). This is different from React's useEffect.
 *
 * Doc gap: `window.CMS_MANUAL_INIT = true` must be set BEFORE the Decap CDN
 * script executes. Since afterNextRender fires after the first render, we set
 * it synchronously as the very first line of the callback — the CDN script is
 * appended after it, so the ordering is guaranteed in the same tick.
 */
@Component({
  selector: 'app-admin',
  standalone: true,
  template: '',
})
export class AdminComponent {
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
