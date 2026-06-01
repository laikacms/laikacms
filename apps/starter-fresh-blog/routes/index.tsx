import type { Handlers, PageProps } from '$fresh/server.ts';
import { collectStream } from 'laikacms/compat';

import { laika } from '../lib/laika.ts';

interface Post {
  key: string;
  updatedAt?: string;
}

export const handler: Handlers<Post[]> = {
  async GET(_req, ctx) {
    const { items } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = items
      .filter(r => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    return ctx.render(posts);
  },
};

export default function HomePage({ data: posts }: PageProps<Post[]>) {
  return (
    <main>
      <h1>My Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href='/admin'>Open the CMS</a> to write your first post.
          </p>
        )
        : (
          <ul style='list-style:none;padding:0'>
            {posts.map(post => {
              const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
              return (
                <li key={post.key} style='margin-bottom:1.5rem'>
                  <a href={`/blog/${slug}`}>{slug}</a>
                  {post.updatedAt && (
                    <>
                      {' · '}
                      <time style='color:#666;font-size:0.9em'>
                        {new Date(post.updatedAt).toLocaleDateString()}
                      </time>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </main>
  );
}
