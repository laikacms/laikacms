import { component$ } from '@builder.io/qwik';
import { routeLoader$ } from '@builder.io/qwik-city';

import { runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from '~/server/laika';

interface Post {
  title: string;
  body: string;
  date: string | null;
}

export const usePost = routeLoader$(async ({ params, status }): Promise<Post | null> => {
  const slug = params.slug;
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    return {
      title: (content.title as string) ?? slug,
      body: (content.body as string) ?? '',
      date: (content.date as string) ?? null,
    };
  } catch (err) {
    if (err instanceof NotFoundError) {
      status(404);
      return null;
    }
    throw err;
  }
});

export default component$(() => {
  const post = usePost();
  if (!post.value) return <p>Post not found.</p>;
  return (
    <article>
      <h2 style="margin-bottom: 0.25rem;">{post.value.title}</h2>
      {post.value.date && <small style="color: #666;">{new Date(post.value.date).toLocaleDateString()}</small>}
      <div style="margin-top: 1.5rem; white-space: pre-wrap;">{post.value.body}</div>
    </article>
  );
});
