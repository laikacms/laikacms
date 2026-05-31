import { createAsync, query, useParams } from '@solidjs/router';
import { Show } from 'solid-js';

import { runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from '~/server/laika';

interface Post {
  title: string;
  body: string;
  date: string | null;
}

const getPost = query(async (slug: string): Promise<Post | null> => {
  'use server';
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
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}, 'post');

export default function PostPage() {
  const params = useParams<{ slug: string }>();
  const post = createAsync(() => getPost(params.slug));

  return (
    <Show when={post()} fallback={<p>Loading…</p>}>
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
  );
}
