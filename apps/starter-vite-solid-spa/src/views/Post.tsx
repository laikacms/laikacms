import { useParams } from '@solidjs/router';
import { createResource, Show } from 'solid-js';

interface Post {
  title: string;
  body: string;
  date: string | null;
}

async function fetchPost(slug: string): Promise<Post | null> {
  const res = await fetch(`/api/posts/${encodeURIComponent(slug)}`);
  if (res.status === 404) return null;
  const body = (await res.json()) as { post: { content?: Record<string, unknown> } };
  const content = (body.post.content ?? {}) as Record<string, unknown>;
  return {
    title: (content.title as string) ?? slug,
    body: (content.body as string) ?? '',
    date: (content.date as string) ?? null,
  };
}

export function Post() {
  const params = useParams<{ slug: string }>();
  const [post] = createResource(() => params.slug, fetchPost);

  return (
    <Show
      when={!post.loading}
      fallback={
        <p>
          <em>Loading…</em>
        </p>
      }
    >
      <Show when={post()} fallback={<p>Post not found.</p>}>
        <article>
          <h2 style="margin-bottom: 0.25rem;">{post()!.title}</h2>
          <Show when={post()!.date}>
            <small style="color: #666;">
              {new Date(post()!.date as string).toLocaleDateString()}
            </small>
          </Show>
          <div style="margin-top: 1.5rem; white-space: pre-wrap;">{post()!.body}</div>
        </article>
      </Show>
    </Show>
  );
}
