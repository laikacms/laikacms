import { A, createAsync, query } from '@solidjs/router';
import { For, Show } from 'solid-js';

import { collectStream } from 'laikacms/compat';

import { laika } from '~/server/laika';

interface PostListItem {
  slug: string;
  title: string;
  date: string | null;
}

// `query` + `createAsync` is SolidStart's data-loading pattern. The function
// inside `query` runs server-side on first request; the result is serialized
// into the HTML and resumes on the client.
const getPosts = query(async (): Promise<PostListItem[]> => {
  'use server';
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
}, 'posts');

export default function Home() {
  const posts = createAsync(() => getPosts());
  return (
    <section>
      <p>
        Edit posts at <a href="/admin">/admin</a> (Decap CMS). Content is stored on disk under{' '}
        <code>./content/posts/</code>.
      </p>
      <ul style="list-style: none; padding: 0;">
        <Show
          when={posts()}
          fallback={
            <li>
              <em>Loading…</em>
            </li>
          }
        >
          <Show
            when={posts()!.length > 0}
            fallback={
              <li>
                <em>No posts yet — add one in the admin UI.</em>
              </li>
            }
          >
            <For each={posts()}>
              {post => (
                <li style="margin-bottom: 1rem;">
                  <A href={`/posts/${post.slug}`}>{post.title}</A>
                </li>
              )}
            </For>
          </Show>
        </Show>
      </ul>
    </section>
  );
}
