/**
 * Eleventy global data file — called at build time (and during --serve watch).
 *
 * Returns an array of post objects that Eleventy makes available as `posts`
 * in every template. Uses laika.documents.* via laikacms/compat so no Effect
 * types leak into template code.
 *
 * Two-step fetch:
 *   1. listRecordSummaries — cheap listing to get all published keys.
 *   2. getDocument per key — loads full frontmatter + body content.
 *
 * For large sites, cache getDocument results or use a CDN; for a starter
 * blog with dozens of posts this is fast enough.
 */
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from '../lib/laika.js';

export default async function() {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  const summaries = records.filter(r => r.type === 'published-summary');

  const posts = await Promise.all(
    summaries.map(async record => {
      const slug = record.key.replace(/^posts\//, '').replace(/\.md$/, '');
      const doc = await runTask(laika.documents.getDocument(record.key));
      return {
        slug,
        key: record.key,
        title: doc.content.title ?? slug,
        date: doc.content.date,
        description: doc.content.description,
        body: doc.content.body,
        updatedAt: record.updatedAt,
      };
    }),
  );

  return posts.sort((a, b) => {
    if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
    return b.slug.localeCompare(a.slug);
  });
}
