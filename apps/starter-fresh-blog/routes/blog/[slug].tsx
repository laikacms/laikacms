import type { Handlers, PageProps } from '$fresh/server.ts';
import { runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { laika } from '../../lib/laika.ts';

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

export const handler: Handlers<PostContent> = {
  async GET(_req, ctx) {
    const { slug } = ctx.params;
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
      return ctx.render(doc.content as PostContent);
    } catch (err) {
      if (err instanceof LaikaError) {
        return new Response('Not Found', { status: 404 });
      }
      throw err;
    }
  },
};

export default function PostPage({ data, params }: PageProps<PostContent>) {
  const { title, date, description, body } = data;
  return (
    <article>
      <h1>{title ?? params.slug}</h1>
      {date && <time style='color:#666'>{new Date(date).toLocaleDateString()}</time>}
      {description && (
        <p>
          <em>{description}</em>
        </p>
      )}
      {/* body is raw markdown — pipe through remark/rehype in production */}
      <pre style='white-space:pre-wrap;font-family:inherit'>{body}</pre>
      <p>
        <a href='/'>← Back</a>
      </p>
    </article>
  );
}
