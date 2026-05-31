import { createFileRoute, notFound } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { runTask } from 'laikacms/compat';

import { laika } from '../laika.js';

const getPost = createServerFn({ method: 'GET' })
  .inputValidator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    try {
      const post = await runTask(laika.documents.getDocument(`posts/${slug}`));
      return post.content as {
        title?: string,
        date?: string,
        description?: string,
        body?: string,
      };
    } catch {
      throw notFound();
    }
  });

export const Route = createFileRoute('/blog/$slug')({
  loader: ({ params }) => getPost({ data: params.slug }),
  notFoundComponent: () => (
    <p>
      Post not found. <a href="/">← Back</a>
    </p>
  ),
  component: PostPage,
});

function PostPage() {
  const { slug } = Route.useParams();
  const post = Route.useLoaderData();
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 640, margin: '2rem auto', padding: '0 1rem' }}>
      <article>
        <h1>{post.title ?? slug}</h1>
        {post.date && <time>{new Date(post.date).toLocaleDateString()}</time>}
        {post.description && (
          <p>
            <em>{post.description}</em>
          </p>
        )}
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>{post.body}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </div>
  );
}
