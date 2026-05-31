import { component$ } from '@builder.io/qwik';
import { Link, routeLoader$ } from '@builder.io/qwik-city';

import { collectStream } from 'laikacms/compat';

import { laika } from '~/server/laika';

interface PostListItem {
  slug: string;
  title: string;
  date: string | null;
}

export const usePosts = routeLoader$(async (): Promise<PostListItem[]> => {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return items
    .filter(item => item.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const slug = (item as { key: string }).key.replace(/^posts\//, '').replace(/\.md$/, '');
      return {
        slug,
        title: (content.title as string) ?? slug,
        date: (content.date as string) ?? null,
      };
    });
});

export default component$(() => {
  const posts = usePosts();
  return (
    <section>
      <p>
        Edit posts at <a href="/admin.html">/admin</a> (Decap CMS). Content is stored on disk under{' '}
        <code>./content/posts/</code>.
      </p>
      <ul style="list-style: none; padding: 0;">
        {posts.value.length === 0 && (
          <li>
            <em>No posts yet — add one in the admin UI.</em>
          </li>
        )}
        {posts.value.map(post => (
          <li key={post.slug} style="margin-bottom: 1rem;">
            <Link href={`/posts/${post.slug}/`}>{post.title}</Link>
            {post.date && (
              <small style="margin-left: 0.5rem; color: #666;">
                {new Date(post.date).toLocaleDateString()}
              </small>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
});
