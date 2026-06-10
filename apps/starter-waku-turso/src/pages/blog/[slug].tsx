import { runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { laika } from '../../laika.js';

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

export const getConfig = () => ({ render: 'dynamic' as const });

export default async function BlogPostPage({ slug }: { slug: string }) {
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof LaikaError) {
      return (
        <p>
          Post not found. <a href="/">← Back</a>
        </p>
      );
    }
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
