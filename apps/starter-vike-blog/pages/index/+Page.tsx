import { useData } from 'vike-react/useData';

import type { Data } from './+data.js';

export default function Page() {
  const { posts } = useData<Data>();

  return (
    <main style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>My Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin">Open the CMS</a> to write your first post.
          </p>
        )
        : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {posts.map(post => (
              <li key={post.slug} style={{ marginBottom: '1.5rem' }}>
                <a href={`/blog/${post.slug}`} style={{ color: '#0070f3' }}>{post.slug}</a>
                {post.updatedAt && (
                  <>
                    {' · '}
                    <time style={{ color: '#666', fontSize: '0.9em' }}>
                      {new Date(post.updatedAt).toLocaleDateString()}
                    </time>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      <p>
        <a href="/admin">Admin →</a>
      </p>
    </main>
  );
}
