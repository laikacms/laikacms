import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createEmbeddedLaika, decapAdminHtml, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';
import { Provide, Singleton } from '@midwayjs/core';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

const decapConfig = minimalBlogConfig({
  backend: { name: 'laika', branch: 'main', api_root: '/api/decap' },
});

// @Singleton so the LaikaCMS instance is created once and shared across requests
@Provide()
@Singleton()
export class LaikaService {
  readonly laika = createEmbeddedLaika({
    contentDir: resolve(__dirname, '..', '..', 'content'),
    basePath: '/api/decap',
    auth: { mode: 'dev' },
    decapConfig,
  });

  readonly adminHtml = decapAdminHtml({
    decapConfig,
    title: 'Admin · LaikaCMS Midway.js starter',
  });
}
