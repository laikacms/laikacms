import { type Handlers, type PageProps } from '$fresh/server.ts';
import { collectStream } from 'laikacms/compat';

import { laika } from '../lib/laika.ts';

interface PostSummary {
  slug: string;
  updatedAt?: string;
}

/**
 * Fresh uses WHATWG Request/Response natively — no adapter between req and
 * laika.fetch is needed. ctx.render() passes data to the page component.
 */
export const handler: Handlers<PostSummary[]> = {
  async GET(_req, ctx) {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts: PostSummary[] = records
      .filter(r => r.type === 'published-summary')
      .map(r => ({
        slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
        updatedAt: r.updatedAt,
      }))
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.slug.localeCompare(a.slug);
      });

    return ctx.render(posts);
  },
};

export default function HomePage({ data: posts }: PageProps<PostSummary[]>) {
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
          <ul style="list-style:none;padding:0">
            {posts.map(post => (
              <li key={post.slug} style="margin-bottom:1.5rem">
                <a href={`/blog/${post.slug}`}>{post.slug}</a>
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
      <p>
        <a href="/admin">Admin →</a>
      </p>
    </main>
  );
}
