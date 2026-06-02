import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';
import { AuthenticationError } from 'laikacms/core';

import { verifyToken } from './auth.ts';

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  basePath: '/api/decap',
  decapConfig: {
    backend: { name: 'laika', api_root: '/api/decap' },
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
  auth: {
    mode: 'custom',
    async authenticateAccessToken(token) {
      try {
        const user = await verifyToken(token);
        return { id: user.sub, email: user.email, name: user.name };
      } catch {
        throw new AuthenticationError('Invalid or expired token');
      }
    },
  },
});
