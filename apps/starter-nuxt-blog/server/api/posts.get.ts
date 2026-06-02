import { collectStream } from 'laikacms/compat';

import { laika } from '../utils/laika';

/**
 * GET /api/posts — list published blog posts.
 *
 * Uses laika.documents.listRecordSummaries via laikacms/compat's collectStream
 * (Promise-friendly, no Effect import needed). The page calls this via useFetch.
 */
export default defineEventHandler(async () => {
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
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.slug.localeCompare(a.slug);
    });
});
