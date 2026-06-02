/**
 * Blog homepage — server component.
 *
 * Reads published post summaries via laika.documents.listRecordSummaries using
 * collectStream from laikacms/compat (Promise-friendly, no Effect import).
 */
import { collectStream } from 'laikacms/compat';

import { laika } from '@/lib/laika';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
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
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  return (
    <main>
      <h1>My Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin">Open the CMS</a> to write your first post.
          </p>
        )
        : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {posts.map(post => {
              const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
              return (
                <li key={post.key} style={{ marginBottom: '1.5rem' }}>
                  <a href={`/blog/${slug}`} style={{ color: '#0070f3' }}>{slug}</a>
                  {post.updatedAt && (
                    <>
                      {' · '}
                      <time style={{ color: '#666', fontSize: '0.9em' }}>
                        {new Date(post.updatedAt).toLocaleDateString()}
                      </time>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </main>
  );
}
