/**
 * Browser-side admin bundle entry point.
 *
 * Bundled by esbuild (pnpm build:admin):
 *   src/admin-client.ts → public/admin/bundle.js
 *
 * Imports from @laikacms/decap-integrations are bundled in so the admin shell
 * works without the package being published to npm (LCMS-055).
 *
 * Note: DEFAULT_DEV_TOKEN is inlined here rather than imported from
 * @laikacms/decap-integrations/embedded because that subpath contains
 * Node.js-only code (fs, path) that cannot be bundled for the browser.
 */
import createLaikaBackend from '@laikacms/decap-integrations/decap-cms-backend-laika';
import _CMS from 'decap-cms-app';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CMS = _CMS as any; // LCMS-064: decap-cms-app types are stricter than runtime allows

// Keep in sync with DEFAULT_DEV_TOKEN in @laikacms/decap-integrations/embedded.
const DEV_TOKEN = 'dev-local-laika-token';

CMS.registerBackend('laika', createLaikaBackend());

CMS.init({
  config: {
    backend: {
      name: 'laika',
      branch: 'main',
      base_url: window.location.origin,
      dev_token: DEV_TOKEN,
    },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: [
      {
        name: 'posts',
        label: 'Posts',
        folder: 'posts',
        create: true,
        slug: '{{slug}}',
        extension: 'md',
        fields: [
          { name: 'title', label: 'Title', widget: 'string' },
          { name: 'date', label: 'Date', widget: 'datetime' },
          { name: 'body', label: 'Body', widget: 'markdown' },
        ],
      },
    ],
  },
});
