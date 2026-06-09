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

// Keep in sync with DEFAULT_DEV_TOKEN in @laikacms/decap-integrations/embedded.
const DEV_TOKEN = 'dev-local-laika-token';

declare const window: Window & {
  CMS: {
    registerBackend: (name: string, backend: unknown) => void,
    init: (options: unknown) => void,
  },
};

const CMS = window.CMS;
CMS.registerBackend('laika', createLaikaBackend());

CMS.init({
  config: {
    backend: {
      name: 'laika',
      api_root: '/api/decap',
      dev_token: DEV_TOKEN,
    },
    media_folder: 'uploads',
    public_folder: '/uploads',
    collections: [
      {
        name: 'posts',
        label: 'Blog Posts',
        folder: 'posts',
        create: true,
        slug: '{{slug}}',
        sortable_fields: ['title', 'date'],
        fields: [
          { label: 'Title', name: 'title', widget: 'string' },
          { label: 'Date', name: 'date', widget: 'datetime' },
          { label: 'Description', name: 'description', widget: 'string', required: false },
          { label: 'Body', name: 'body', widget: 'markdown' },
        ],
      },
    ],
  },
});
