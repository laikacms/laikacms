import { createAsync, type RouteDefinition, useParams } from '@solidjs/router';
import { Show } from 'solid-js';

import { getPost } from '~/lib/content.js';

export const route = {
  preload: ({ params }) => getPost(params.slug!),
} satisfies RouteDefinition;

export default function BlogPost() {
  const params = useParams<{ slug: string }>();
  const post = createAsync(() => getPost(params.slug));

  return (
    <div style={{ 'font-family': 'sans-serif', 'max-width': '640px', margin: '2rem auto', padding: '0 1rem' }}>
      <Show when={post()} fallback={<p>Loading…</p>}>
        {p => {
          const content = p().content as {
            title?: string,
            date?: string,
            description?: string,
            body?: string,
          };
          return (
            <article>
              <h1>{content.title ?? params.slug}</h1>
              <Show when={content.date}>
                <time>{new Date(content.date!).toLocaleDateString()}</time>
              </Show>
              <Show when={content.description}>
                <p>
                  <em>{content.description}</em>
                </p>
              </Show>
              {/* body is raw markdown; pipe through remark/rehype in production */}
              <pre style={{ 'white-space': 'pre-wrap', 'font-family': 'inherit' }}>{content.body}</pre>
            </article>
          );
        }}
      </Show>
      <p>
        <a href="/">← Back</a>
      </p>
    </div>
  );
}
