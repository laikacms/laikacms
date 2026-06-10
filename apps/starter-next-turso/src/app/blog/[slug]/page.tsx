import { runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';
import { notFound } from 'next/navigation';

import { laika } from '@/lib/laika';

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

export const dynamic = 'force-dynamic';

export default async function PostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof LaikaError) notFound();
    throw err;
  }

  const { title, date, description, body } = post.content as PostContent;

  return (
    <article>
      <h1>{title ?? slug}</h1>
      {date && <time style={{ color: '#666' }}>{new Date(date).toLocaleDateString()}</time>}
      {description && (
        <p>
          <em>{description}</em>
        </p>
      )}
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{body}</pre>
      <p>
        <a href="/">← Back</a>
      </p>
    </article>
  );
}
