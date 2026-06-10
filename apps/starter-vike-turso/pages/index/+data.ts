/**
 * Server-side data loader for the blog homepage.
 *
 * Vike runs +data.ts exclusively on the server (never in the browser).
 * The return value is serialised to JSON and passed to the page component
 * via `useData()`. This means laika.documents.* can be called directly here
 * without going back through HTTP.
 */
import { collectStream } from 'laikacms/compat';

import { laika } from '../../src/laika.js';

export interface PostSummary {
  key: string;
  slug: string;
  updatedAt: string | undefined;
}

export async function data() {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  type RawSummary = { key: string, updatedAt?: string, type: string };

  const posts: PostSummary[] = (items as RawSummary[])
    .filter((r): r is RawSummary => r.type === 'published-summary')
    .map(r => ({
      key: r.key,
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.slug.localeCompare(a.slug);
    });

  return { posts };
}

export type Data = Awaited<ReturnType<typeof data>>;
