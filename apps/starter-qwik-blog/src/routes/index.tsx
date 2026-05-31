import { component$ } from '@builder.io/qwik';
import { Link, routeLoader$ } from '@builder.io/qwik-city';
import { collectStream } from 'laikacms/compat';

import { laika } from '~/lib/laika.server';

export const usePosts = routeLoader$(async () => {
  const { items } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  type RawSummary = { key: string, updatedAt?: string, type: string };

  return (items as RawSummary[])
    .filter(r => r.type === 'published-summary')
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.slug.localeCompare(a.slug);
    });
});

export default component$(() => {
  const posts = usePosts();

  return (
    <main style="max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; font-family: system-ui, sans-serif;">
      <h1>My Blog</h1>
      {posts.value.length === 0
        ? (
          <p>
            No posts yet. <Link href="/admin">Open the CMS</Link> to write your first post.
          </p>
        )
        : (
          <ul style="list-style: none; padding: 0;">
            {posts.value.map(post => (
              <li key={post.slug} style="margin-bottom: 1.5rem;">
                <Link href={`/blog/${post.slug}`}>{post.slug}</Link>
                {post.updatedAt && (
                  <>
                    {' · '}
                    <time>{new Date(post.updatedAt).toLocaleDateString()}</time>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
    </main>
  );
});
