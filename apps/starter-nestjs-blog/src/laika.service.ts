import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';
import { Injectable } from '@nestjs/common';

import { blogCollections } from './decap-config.js';

/**
 * NestJS injectable wrapper around createEmbeddedLaika.
 *
 * Providing laika as a singleton service means it's instantiated once per
 * application lifecycle — matching the singleton pattern used in all other
 * starters. Inject LaikaService in controllers or other services.
 */
@Injectable()
export class LaikaService {
  readonly instance = createEmbeddedLaika({
    contentDir: resolve(process.cwd(), 'content'),
    basePath: '/api/decap',
    auth: { mode: 'dev' },
    decapConfig: {
      backend: { name: 'laika', api_url: '/api/decap' },
      media_folder: 'public/uploads',
      public_folder: '/uploads',
      collections: blogCollections,
    },
  });

  fetch(request: Request) {
    return this.instance.fetch(request);
  }

  get documents() {
    return this.instance.documents;
  }
}
