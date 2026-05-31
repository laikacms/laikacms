/**
 * Blog homepage — HonoX route.
 *
 * createRoute wraps a Hono handler. c.req.raw is the Web API Request.
 * collectStream from laikacms/compat gives Promise-friendly access to laika.documents.
 */
import { createRoute } from 'honox/factory';
import { collectStream } from 'laikacms/compat';

import { laika } from '../../src/laika.js';

export default createRoute(async c => {
  const { items: records } = await collectStream(
    laika.documents.listRecordSummaries({
      pagination: { page: 1, perPage: 100 },
      folder: 'posts',
      depth: 1,
      type: 'published',
    }),
  );

  type Summary = { type: string, key: string, updatedAt?: string };

  const posts = (records as Summary[])
    .filter(r => r.type === 'published-summary')
    .sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.key.localeCompare(a.key);
    });

  return c.render(
    <main>
      <h1>My Blog</h1>
      {posts.length === 0
        ? <p>No posts yet. <a href="/admin/">Open the CMS</a> to write your first post.</p>
        : (
          <ul style="list-style:none;padding:0">
            {posts.map(post => {
              const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
              return (
                <li key={post.key} style="margin-bottom:1.5rem">
                  <a href={`/blog/${slug}`}>{slug}</a>
                  {post.updatedAt && (
                    <time style="color:#666;font-size:0.9em">
                      {' · '}{new Date(post.updatedAt).toLocaleDateString()}
                    </time>
                  )}
                </li>
              );
            })}
          </ul>
        )}
    </main>,
    { title: 'My Blog' },
  );
});
