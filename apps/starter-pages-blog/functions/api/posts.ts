/**
 * Pages Function: GET /api/posts
 *
 * Returns the list of published blog posts as JSON.
 * The static homepage (public/index.html) fetches this to render the post list.
 */
import { collectStream, type Env, getLaika, type RecordSummary } from '../../src/laika-factory.js';

export const onRequestGet: PagesFunction<Env> = async context => {
  const { documents } = await getLaika(context.env);

  try {
    const { items } = await collectStream(
      documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = (items as RecordSummary[])
      .filter(r => r.type === 'published-summary')
      .map(r => ({
        slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
        updatedAt: 'updatedAt' in r ? r.updatedAt : null,
      }))
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.slug.localeCompare(a.slug);
      });

    return Response.json(posts);
  } catch (err) {
    console.error('starter-pages-blog: error listing posts', err);
    return Response.json({ error: 'Failed to load posts' }, { status: 500 });
  }
};
