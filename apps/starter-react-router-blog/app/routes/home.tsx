import { collectStream } from 'laikacms/compat';
import type { LoaderFunctionArgs } from 'react-router';
import { Link, useLoaderData } from 'react-router';

import { laika } from '~/lib/laika.server';

export async function loader(_args: LoaderFunctionArgs) {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  type RawSummary = { key: string, updatedAt?: string, type: string };

  const posts = (records as RawSummary[])
    .filter(r => r.type === 'published-summary')
    .map(r => ({
      slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
      updatedAt: r.updatedAt ?? null,
    }))
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.slug.localeCompare(a.slug);
    });

  return { posts };
}

export function meta() {
  return [{ title: 'My Blog' }];
}

export default function Home() {
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
