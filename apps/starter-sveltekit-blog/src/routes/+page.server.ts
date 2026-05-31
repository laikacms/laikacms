import { collectStream } from 'laikacms/compat';

import { laika } from '$lib/laika';

/**
 * Blog homepage — server load function.
 *
 * Reads published post summaries via laika.documents.listRecordSummaries using
 * collectStream from laikacms/compat (Promise-friendly, no Effect import).
 */
export async function load() {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const posts = records
    .filter(r => r.type === 'published-summary')
    .map(r => ({
      key: r.key,
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  return { posts };
}
