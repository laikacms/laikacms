import { Layout } from './Layout.js';

export interface PostSummary {
  slug: string;
  date?: string;
}

export function HomePage({ posts }: { posts: PostSummary[] }) {
  return (
    <Layout title="My Blog">
      <h1>My Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.
          </p>
        )
        : (
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {posts.map(post => (
              <li key={post.slug} style={{ marginBottom: '1rem' }}>
                <a href={`/blog/${post.slug}`}>{post.slug}</a>
                {post.date && (
                  <>
                    {' '}· <time>{new Date(post.date).toLocaleDateString()}</time>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
    </Layout>
  );
}
