import { query } from '@solidjs/router';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

export const getPosts = query(async () => {
  'use server';
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return records
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });
}, 'posts');

export const getPost = query(async (slug: string) => {
  'use server';
  return runTask(laika.documents.getDocument(`posts/${slug}`));
}, 'post');
