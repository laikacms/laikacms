import { createAsync, type RouteDefinition } from '@solidjs/router';
import { For, Show } from 'solid-js';

import { getPosts } from '~/lib/content.js';

export const route = {
  preload: () => getPosts(),
} satisfies RouteDefinition;

export default function Home() {
  const posts = createAsync(() => getPosts());

  return (
    <div style={{ 'font-family': 'sans-serif', 'max-width': '640px', margin: '2rem auto', padding: '0 1rem' }}>
      <h1>My Blog</h1>
      <Show when={(posts()?.length ?? 0) === 0}>
        <p>
          No posts yet. <a href="/admin">Open the CMS</a> to write your first post.
        </p>
      </Show>
      <ul style={{ 'list-style': 'none', padding: '0' }}>
        <For each={posts()}>
          {post => {
            const slug = post.key.replace(/^posts\//, '').replace(/\.md$/, '');
            return (
              <li style={{ 'margin-bottom': '1rem' }}>
                <a href={`/blog/${slug}`}>{slug}</a>
                <Show when={post.updatedAt}>
                  {' · '}
                  <time>{new Date(post.updatedAt!).toLocaleDateString()}</time>
                </Show>
              </li>
            );
          }}
        </For>
      </ul>
      <p>
        <a href="/admin">Admin →</a>
      </p>
    </div>
  );
}
