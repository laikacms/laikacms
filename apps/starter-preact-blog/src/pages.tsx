/** @jsxImportSource preact */
import type { ComponentChildren } from 'preact';

// --- Shared layout ----------------------------------------------------------

export function Layout({ title, children }: { title: string, children: ComponentChildren }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{title}</title>
        <style>
          {`
          body { font-family: system-ui, sans-serif; max-width: 48rem; margin: 2rem auto; padding: 0 1rem; }
          a { color: #0070f3; }
          nav { margin-bottom: 2rem; }
          .post-list { list-style: none; padding: 0; }
          .post-list li { margin-bottom: 1rem; }
          time { color: #666; font-size: 0.875rem; margin-left: 0.5rem; }
        `}
        </style>
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          {' · '}
          <a href="/admin/">Admin</a>
        </nav>
        {children}
      </body>
    </html>
  );
}

// --- Blog list page ---------------------------------------------------------

type PostSummary = { slug: string, updatedAt?: string };

export function BlogListPage({ posts }: { posts: PostSummary[] }) {
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
          <ul class="post-list">
            {posts.map(post => (
              <li key={post.slug}>
                <a href={`/blog/${post.slug}`}>{post.slug}</a>
                {post.updatedAt && <time>{new Date(post.updatedAt).toLocaleDateString()}</time>}
              </li>
            ))}
          </ul>
        )}
    </Layout>
  );
}

// --- Blog post page ---------------------------------------------------------

export type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

export function BlogPostPage({ slug, post }: { slug: string, post: PostContent }) {
  const { title, date, description, body } = post;
  return (
    <Layout title={title ?? slug}>
      <article>
        <h1>{title ?? slug}</h1>
        {date && <time>{new Date(date).toLocaleDateString()}</time>}
        {description && (
          <p>
            <em>{description}</em>
          </p>
        )}
        <pre style="white-space:pre-wrap;font-family:inherit">{body ?? ''}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </Layout>
  );
}

// --- Not found --------------------------------------------------------------

export function NotFoundPage() {
  return (
    <Layout title="Not Found">
      <h1>404</h1>
      <p>Page not found.</p>
    </Layout>
  );
}
