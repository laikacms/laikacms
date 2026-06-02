import { createDefine } from 'fresh';
import { runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from '../../lib/laika.ts';

const define = createDefine<Record<never, never>>();

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

interface Data {
  slug: string;
  content: PostContent;
}

export const handler = define.handlers<Data>({
  async GET(ctx) {
    const slug = ctx.params.slug ?? '';
    let post;
    try {
      post = await runTask(laika.documents.getDocument(`posts/${slug}`));
    } catch (err) {
      if (err instanceof NotFoundError) {
        return new Response('Not Found', { status: 404 });
      }
      throw err;
    }
    return { data: { slug, content: post.content as PostContent } };
  },
});

export default define.page<typeof handler>(function Post({ data }: { data: Data }) {
  const { slug, content } = data;
  const { title, date, description, body } = content;

  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>{title ?? slug}</title>
      </head>
      <body style="font-family:system-ui,sans-serif;max-width:48rem;margin:0 auto;padding:1rem 1.5rem">
        <article>
          <h1>{title ?? slug}</h1>
          {date && (
            <time style="color:#666">
              {new Date(date).toLocaleDateString()}
            </time>
          )}
          {description && (
            <p>
              <em>{description}</em>
            </p>
          )}
          {/* body is raw markdown — pipe through remark/rehype in production */}
          <pre style="white-space:pre-wrap;font-family:inherit">{body ?? ''}</pre>
          <p>
            <a href="/">← Back</a>
          </p>
        </article>
      </body>
    </html>
  );
});
