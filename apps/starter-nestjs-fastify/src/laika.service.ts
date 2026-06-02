import { resolve } from 'node:path';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Injectable } from '@nestjs/common';

/**
 * NestJS injectable wrapper around createEmbeddedLaika.
 *
 * Using decapAdminHtml() + minimalBlogConfig() eliminates the admin bundle
 * build step (no admin-client.ts, no esbuild). Compare with starter-nestjs-blog
 * (Express) which uses the manual public/admin/index.html + bundle approach.
 */
@Injectable()
export class LaikaService {
  readonly decapConfig = minimalBlogConfig();

  readonly instance = createEmbeddedLaika({
    contentDir: resolve(process.cwd(), 'content'),
    decapConfig: this.decapConfig,
    basePath: '/api/decap',
    auth: { mode: 'dev' },
  });

  readonly adminHtml = decapAdminHtml({
    decapConfig: this.decapConfig,
    title: 'Admin · LaikaCMS NestJS/Fastify',
  });

  fetch(request: Request) {
    return this.instance.fetch(request);
  }

  get documents() {
    return this.instance.documents;
  }
}
