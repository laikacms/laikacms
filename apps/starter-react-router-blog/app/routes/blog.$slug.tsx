import { runTask } from 'laikacms/compat';
import type { LoaderFunctionArgs, MetaArgs } from 'react-router';
import { data, Link, useLoaderData } from 'react-router';

import { laika } from '~/lib/laika.server';

export async function loader({ params }: LoaderFunctionArgs) {
  const { slug } = params;
  if (!slug) throw data('Not found', { status: 404 });

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    throw data('Not found', { status: 404 });
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return {
    slug,
    title: title ?? null,
    date: date ?? null,
    description: description ?? null,
    body: body ?? null,
  };
}

export function meta({ data: post }: MetaArgs<typeof loader>) {
  return [
    { title: post?.title ?? post?.slug ?? 'Post' },
    ...(post?.description ? [{ name: 'description', content: post.description }] : []),
  ];
}

export default function BlogPost() {
  const { slug, title, date, description, body } = useLoaderData<typeof loader>();

  return (
    <article>
      <h1>{title ?? slug}</h1>
      {date && <time>{new Date(date).toLocaleDateString()}</time>}
      {description && (
        <p>
          <em>{description}</em>
        </p>
      )}
      {/* body is raw markdown; use remark/rehype in a production app */}
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{body}</pre>
      <p>
        <Link to="/">← Back</Link>
      </p>
    </article>
  );
}
