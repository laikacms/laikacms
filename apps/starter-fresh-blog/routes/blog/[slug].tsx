import { type Handlers, type PageProps } from '$fresh/server.ts';
import { runTask } from 'laikacms/compat';

import { laika } from '../../lib/laika.ts';

interface Post {
  slug: string;
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

export const handler: Handlers<Post> = {
  async GET(_req, ctx) {
    const { slug } = ctx.params;
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
      const { title, date, description, body } = doc.content as {
        title?: string;
        date?: string;
        description?: string;
        body?: string;
      };
      return ctx.render({ slug, title, date, description, body });
    } catch {
      return ctx.renderNotFound();
    }
  },
};

export default function PostPage({ data: post }: PageProps<Post>) {
  return (
    <main>
      <article>
        <h1>{post.title ?? post.slug}</h1>
        {post.date && <time>{new Date(post.date).toLocaleDateString()}</time>}
        {post.description && <p><em>{post.description}</em></p>}
        <pre style="white-space:pre-wrap;font-family:inherit">{post.body}</pre>
      </article>
      <p>
        <a href="/">← Back</a>
      </p>
    </main>
  );
}
