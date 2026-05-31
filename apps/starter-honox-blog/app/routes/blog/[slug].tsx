/**
 * Blog post page — HonoX route with dynamic [slug] parameter.
 *
 * Uses runTask from laikacms/compat to fetch a single post by key.
 */
import { createRoute } from 'honox/factory';
import { runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { laika } from '../../../src/laika.js';

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

export default createRoute(async c => {
  const slug = c.req.param('slug');

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof LaikaError) {
      return c.notFound();
    }
    throw err;
  }

  const { title, date, description, body } = post.content as PostContent;

  return c.render(
    <article>
      <h1>{title ?? slug}</h1>
      {date && <time style="color:#666">{new Date(date).toLocaleDateString()}</time>}
      {description && (
        <p>
          <em>{description}</em>
        </p>
      )}
      {/* body is raw markdown — pipe through remark/rehype in production */}
      <pre style="white-space:pre-wrap;font-family:inherit">{body}</pre>
      <p>
        <a href="/">← Back</a>
      </p>
    </article>,
    { title: title ?? slug },
  );
});
