/**
 * Server-side data queries — imported by routes for SSR.
 *
 * query() from @solidjs/router creates a cached, preloadable data loader.
 * The "use server" directive inside each async function body tells vinxi to
 * extract that function into a server-side RPC — the client receives a typed
 * stub that makes an HTTP call; the implementation never enters the browser bundle.
 *
 * Doc note: "use server" must be the very first statement in the function body.
 * A comment above it is fine; any import or expression before it silently breaks
 * the directive and ships the function to the client.
 */
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
