import { resolve } from 'node:path';

import { createEmbeddedLaika } from '@laikacms/decap-integrations/embedded';

/**
 * Two collections in one Decap config: `posts` (the public content) and
 * `comments` (the moderation queue). Decap shows them as two folders in
 * the admin UI — moderators can edit/delete from the same place as
 * regular content.
 */
const decapConfig = {
  backend: {
    name: 'git-gateway',
    branch: 'main',
  },
  media_folder: 'content/uploads',
  collections: [
    {
      name: 'posts',
      label: 'Posts',
      folder: 'content/posts',
      create: true,
      fields: [
        { name: 'title', label: 'Title', widget: 'string' },
        { name: 'date', label: 'Date', widget: 'datetime' },
        { name: 'body', label: 'Body', widget: 'markdown' },
      ],
    },
    {
      name: 'comments',
      label: 'Comments',
      folder: 'content/comments',
      create: false,
      fields: [
        { name: 'postSlug', label: 'Post slug', widget: 'string' },
        { name: 'author', label: 'Author', widget: 'string' },
        { name: 'body', label: 'Comment body', widget: 'text' },
        { name: 'createdAt', label: 'Created at', widget: 'datetime' },
        {
          name: 'status',
          label: 'Status',
          widget: 'select',
          options: ['pending', 'approved', 'rejected'],
        },
      ],
    },
  ],
} as const;

export const laika = createEmbeddedLaika({
  contentDir: resolve(process.cwd(), 'content'),
  decapConfig,
  basePath: '/api/decap',
  auth: { mode: 'dev' },
});

export { decapConfig };
