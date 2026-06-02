import { collectStream } from 'laikacms/compat';

import { makeLaika } from '$lib/laika';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ platform }) => {
  const laika = makeLaika(platform!.env.DB);

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
};
