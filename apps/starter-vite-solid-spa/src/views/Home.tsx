import { A } from '@solidjs/router';
import { createResource, For, Show } from 'solid-js';

interface PostListItem {
  key: string;
  slug: string;
  title: string | null;
}

async function fetchPosts(): Promise<PostListItem[]> {
  const res = await fetch('/api/posts');
  const body = (await res.json()) as {
    posts: Array<{ key: string, content?: Record<string, unknown> }>,
  };
  return body.posts.map(p => ({
    key: p.key,
    slug: p.key.replace(/^posts\//, '').replace(/\.md$/, ''),
    title: (p.content?.title as string) ?? null,
  }));
}

export function Home() {
  const [posts] = createResource(fetchPosts);
  return (
    <section>
      <p>
        Edit posts at <a href="/admin">/admin</a> (Decap CMS). This page is a Solid.js SPA that fetches{' '}
        <code>/api/posts</code> from the sidecar Hono backend.
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
                  <A href={`/posts/${post.slug}`}>{post.title ?? post.slug}</A>
                </li>
              )}
            </For>
          </Show>
        </Show>
      </ul>
    </section>
  );
}
