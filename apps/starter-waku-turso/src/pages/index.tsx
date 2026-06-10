import { collectStream } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { laika } from '../laika.js';

export const getConfig = () => ({ render: 'dynamic' as const });

export default async function HomePage() {
  type Summary = { type: string, key: string, updatedAt?: string };

  let posts: Summary[] = [];
  try {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );
    posts = (records as Summary[])
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });
  } catch (err) {
    if (!(err instanceof LaikaError)) throw err;
  }

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
      <p>
        <a href="/admin" style={{ color: '#888' }}>Admin →</a>
      </p>
    </main>
  );
}
