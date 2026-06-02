import { resolve } from 'node:path';

import { createEmbeddedLaika, minimalBlogConfig } from '@laikacms/decap-integrations/embedded';

// Override the default minimalBlogConfig to add a language picker on the
// post collection. Decap shows a dropdown; the resulting field lands in
// document.language.
const decapConfig = minimalBlogConfig({
  extraCollections: [],
});

// Decap supports an `i18n` section on the config — see
// https://decapcms.org/docs/i18n/ . The embedded preset doesn't ship it by
// default; uncomment to add full i18n collection support in the admin UI:
//
// (decapConfig as Record<string, unknown>).i18n = {
//   structure: 'multiple_folders',
//   locales: ['en', 'nl', 'de'],
//   default_locale: 'en',
// };

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
