import { decapAdminHtml } from '@laikacms/decap-integrations/custom';
import { defineEventHandler } from 'h3';

import { blogCollections } from '../decap-config.js';

const ADMIN_HTML = decapAdminHtml({
  decapConfig: {
    backend: { name: 'laika', api_url: '/api/decap' },
    media_folder: 'uploads',
    public_folder: '/uploads',
    collections: blogCollections,
  },
});

export default defineEventHandler(() =>
  new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html; charset=utf-8' } })
);
