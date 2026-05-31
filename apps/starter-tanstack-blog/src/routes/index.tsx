import { createFileRoute, Link } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { collectStream } from 'laikacms/compat';

import { laika } from '../laika.js';

/**
 * createServerFn creates a server-only RPC endpoint.
 * The handler is never bundled into the client; the client gets a typed stub.
 * laika.documents reads content directly from the filesystem — no HTTP round-trip.
 */
const listPosts = createServerFn({ method: 'GET' }).handler(async () => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );
  return items
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });
});

export const Route = createFileRoute('/')({
  loader: () => listPosts(),
  component: HomePage,
});

function HomePage() {
  const posts = Route.useLoaderData();
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
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
                <li key={slug} style={{ marginBottom: '1rem' }}>
                  <Link to="/blog/$slug" params={{ slug }}>{slug}</Link>
                  {post.updatedAt && (
                    <>
                      {' · '}
                      <time>{new Date(post.updatedAt).toLocaleDateString()}</time>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      <p>
        <a href="/admin">Admin →</a>
      </p>
    </div>
  );
}
