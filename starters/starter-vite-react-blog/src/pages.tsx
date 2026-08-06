/**
 * Shared React components for server-side rendering.
 *
 * Rendered with renderToStaticMarkup (no hydration) for simplicity.
 * For a hydrated app, use renderToString + client-side hydrateRoot instead.
 */

export function Layout({ children, title = 'Blog' }: { children: React.ReactNode, title?: string }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>{title}</title>
      </head>
      <body>{children}</body>
    </html>
  );
}

export function HomePage({ posts }: { posts: Array<{ key: string }> }) {
  const slug = (key: string) => key.replace(/^posts\//, '').replace(/\.md$/, '');
  return (
    <Layout>
      <h1>Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/admin">Open the CMS</a>
          </p>
        )
        : (
          <ul>
            {posts.map(p => (
              <li key={p.key}>
                <a href={`/blog/${slug(p.key)}`}>{slug(p.key)}</a>
              </li>
            ))}
          </ul>
        )}
      <p>
        <a href="/admin">Edit in CMS →</a>
      </p>
    </Layout>
  );
}

export function PostPage({
  slug,
  post,
}: {
  slug: string,
  post: { title?: string, date?: string, description?: string, body?: string },
}) {
  return (
    <Layout title={post.title ?? slug}>
      <article>
        <h1>{post.title ?? slug}</h1>
        {post.date && <time>{new Date(post.date).toLocaleDateString()}</time>}
        {post.description && (
          <p>
            <em>{post.description}</em>
          </p>
        )}
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{post.body ?? ''}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </Layout>
  );
}

export function NotFoundPage() {
  return (
    <Layout title="404">
      <p>
        Not found. <a href="/">← Back</a>
      </p>
    </Layout>
  );
}
