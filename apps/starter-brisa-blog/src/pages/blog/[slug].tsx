import type { RequestContext } from 'brisa';
import { runTask } from 'laikacms/compat';

import { laika } from '../../lib/laika.ts';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

export default async function BlogPost(_props: Record<never, never>, req: RequestContext) {
  const route = req.route;
  const slug = Array.isArray(route.params?.slug)
    ? route.params.slug.join('/')
    : (route.params?.slug ?? '');

  let post: PostContent = {};
  let notFound = false;

  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    post = doc.content as PostContent;
  } catch {
    notFound = true;
  }

  if (notFound) {
    return (
      <main>
        <h1>Post not found</h1>
        <p>
          <a href="/">← Back</a>
        </p>
      </main>
    );
  }

  return (
    <article>
      <h1>{post.title ?? slug}</h1>
      {post.date && <time>{new Date(post.date).toLocaleDateString()}</time>}
      {post.description && (
        <p>
          <em>{post.description}</em>
        </p>
      )}
      {post.body && <div class="body">{post.body}</div>}
      <p>
        <a href="/">← Back</a>
      </p>
    </article>
  );
}
