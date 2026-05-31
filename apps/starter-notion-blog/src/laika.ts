import { createCustomLaika } from '@laikacms/decap-integrations/custom';
import { NotionStorageRepository } from '@laikacms/notion/storage-notion';

import { blogCollections } from './decap-config.js';

// Required env vars:
//   NOTION_TOKEN        — Integration token (secret_...) from notion.so/my-integrations
//   NOTION_ROOT_PAGE_ID — Page ID of the Notion page to use as the storage root
//                         (share it with your integration first)
//
// Notion stores content as plain paragraph blocks inside pages. Files map to
// child pages; folders map to pages with sub-pages. LaikaCMS reads/writes page
// titles and paragraph text — markdown serializers are bypassed.
const token = process.env['NOTION_TOKEN'];
const rootPageId = process.env['NOTION_ROOT_PAGE_ID'];

if (!token || !rootPageId) {
  throw new Error(
    'Missing required env vars: NOTION_TOKEN and NOTION_ROOT_PAGE_ID must both be set.\n'
      + 'Create an integration at https://notion.so/my-integrations, then share your root page with it.',
  );
}

const storage = new NotionStorageRepository({ auth: { accessToken: token }, rootPageId });

export const laika = createCustomLaika({
  storage,
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'public/uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});
