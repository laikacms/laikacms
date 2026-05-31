import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { collectStream } from 'laikacms/compat';

import { laika } from '~/lib/laika.server';

/**
 * Blog homepage loader — lists published posts using laika.documents.listRecordSummaries
 * via laikacms/compat's collectStream (Promise-friendly, no Effect import needed).
 */
export async function loader(_args: LoaderFunctionArgs) {
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
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.slug.localeCompare(a.slug);
    });

  return json({ posts });
}

export const meta: MetaFunction = () => [{ title: 'My Blog' }];

export default function Index() {
  const { posts } = useLoaderData<typeof loader>();

  if (posts.length === 0) {
    return (
      <div>
        <h1>My Blog</h1>
        <p>
          No posts yet. <Link to="/admin">Open the CMS</Link> to write your first post.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1>My Blog</h1>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {posts.map(post => (
          <li key={post.slug} style={{ marginBottom: '1.5rem' }}>
            <Link to={`/blog/${post.slug}`}>{post.slug}</Link>
            {post.updatedAt && (
              <>
                {' · '}
                <time>{new Date(post.updatedAt).toLocaleDateString()}</time>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
