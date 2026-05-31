import { component$ } from '@builder.io/qwik';
import { type DocumentHead, Link, routeLoader$ } from '@builder.io/qwik-city';
import { runTask } from 'laikacms/compat';

import { laika } from '~/lib/laika.server';

export const usePost = routeLoader$(async ({ params, status }) => {
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${params.slug}`));
  } catch {
    status(404);
    return null;
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return {
    slug: params.slug,
    title: title ?? null,
    date: date ?? null,
    description: description ?? null,
    body: body ?? null,
  };
});

export const head: DocumentHead = ({ resolveValue }) => {
  const post = resolveValue(usePost);
  return {
    title: post?.title ?? post?.slug ?? 'Post',
    meta: post?.description ? [{ name: 'description', content: post.description }] : [],
  };
};

export default component$(() => {
  const post = usePost();

  if (!post.value) {
    return <p>Post not found.</p>;
  }

  const { slug, title, date, description, body } = post.value;

  return (
    <main style="max-width: 48rem; margin: 0 auto; padding: 2rem 1rem; font-family: system-ui, sans-serif;">
      <article>
        <h1>{title ?? slug}</h1>
        {date && <time>{new Date(date).toLocaleDateString()}</time>}
        {description && (
          <p>
            <em>{description}</em>
          </p>
        )}
        {/* body is raw markdown; use @mdx-js/qwik or remark in a production app */}
        <pre style="white-space: pre-wrap; font-family: inherit;">{body}</pre>
        <p>
          <Link href="/">← Back</Link>
        </p>
      </article>
    </main>
  );
});
