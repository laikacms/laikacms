/**
 * Vercel Edge Function — GET /api/posts
 *
 * Returns published blog post summaries as JSON.
 * The static homepage (public/index.html) fetches this to render the post list.
 */
export const config = { runtime: 'edge' };

import { collectStream, getLaika, type RecordSummary } from '../src/laika-factory.js';

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const { documents } = await getLaika({
    BLOB_READ_WRITE_TOKEN: process.env.BLOB_READ_WRITE_TOKEN,
    DEV_TOKEN: process.env.DEV_TOKEN,
  });

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

    return Response.json(posts, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('starter-vercel-blog: error listing posts', err);
    return Response.json({ error: 'Failed to load posts' }, { status: 500 });
  }
}
