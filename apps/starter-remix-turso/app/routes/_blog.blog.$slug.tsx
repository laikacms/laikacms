import type { LoaderFunctionArgs, MetaFunction } from '@remix-run/node';
import { json } from '@remix-run/node';
import { Link, useLoaderData } from '@remix-run/react';
import { runTask } from 'laikacms/compat';

import { laika } from '~/lib/laika.server';

export async function loader({ params }: LoaderFunctionArgs) {
  const { slug } = params;
  if (!slug) throw new Response('Not found', { status: 404 });

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    throw new Response('Not found', { status: 404 });
  }

  const { title, date, description, body } = post.content as {
    title?: string,
    date?: string,
    description?: string,
    body?: string,
  };

  return json({
    slug,
    title: title ?? null,
    date: date ?? null,
    description: description ?? null,
    body: body ?? null,
  });
}

export const meta: MetaFunction<typeof loader> = ({ data }) => [
  { title: data?.title ?? data?.slug ?? 'Post' },
  ...(data?.description ? [{ name: 'description', content: data.description }] : []),
];

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
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{body}</pre>
      <p>
        <Link to="/">← Back</Link>
      </p>
    </article>
  );
}
