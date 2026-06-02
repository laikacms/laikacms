import { createDefine } from 'fresh';
import { collectStream } from 'laikacms/compat';

import { laika } from '../lib/laika.ts';

// State type can be extended for auth/session data.
const define = createDefine<Record<never, never>>();

interface PostSummary {
  key: string;
  updatedAt?: string;
}

interface Data {
  posts: PostSummary[];
}

export const handler = define.handlers<Data>({
  async GET(_ctx) {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = records
      .filter((r): r is typeof r & { type: 'published-summary' } => r.type === 'published-summary')
      .sort((a, b) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      });

    return { data: { posts } };
  },
});

export default define.page<typeof handler>(function Home({ data }: { data: Data }) {
  const { posts } = data;
  const bodyContent = posts.length === 0
    ? (
      <p>
        No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.
      </p>
    )
    : (
      <ul style="list-style:none;padding:0">
        {posts.map(post => {
          const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
          return (
            <li key={slug} style="margin-bottom:1rem">
              <a href={`/blog/${slug}`}>{slug}</a>
              {post.updatedAt && (
                <>
                  {' · '}
                  <time style="color:#666">
                    {new Date(post.updatedAt).toLocaleDateString()}
                  </time>
                </>
              )}
            </li>
          );
        })}
      </ul>
    );

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>My Blog</title>
      </head>
      <body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
        <h1>My Blog</h1>
        {bodyContent}
        <p>
          <a href="/admin/">Admin →</a>
        </p>
      </body>
    </html>
  );
});
