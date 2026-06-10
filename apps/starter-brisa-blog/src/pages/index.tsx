import type { RequestContext } from 'brisa';
import { collectStream } from 'laikacms/compat';

import { laika } from '../lib/laika.ts';

type PostSummary = { type: string, key: string, updatedAt?: string };

export default async function BlogIndex(_props: Record<never, never>, _req: RequestContext) {
  let posts: PostSummary[] = [];
  try {
    const { items } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );
    posts = (items as PostSummary[]).filter(r => r.type === 'published-summary');
    posts.sort((a, b) => (b.updatedAt ?? b.key).localeCompare(a.updatedAt ?? a.key));
  } catch {
    // No posts yet
  }

  return (
    <main>
      <h1>My Brisa Blog</h1>
      {posts.length === 0
        ? (
          <p>
            No posts yet. <a href="/api/admin">Open the CMS →</a>
          </p>
        )
        : (
          <ul>
            {posts.map(post => {
              const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
              return (
                <li key={slug}>
                  <a href={`/blog/${slug}`}>{slug}</a>
                  {post.updatedAt && <time>· {new Date(post.updatedAt).toLocaleDateString()}</time>}
                </li>
              );
            })}
          </ul>
        )}
      <p>
        <a href="/api/admin">Admin →</a>
      </p>
    </main>
  );
}
