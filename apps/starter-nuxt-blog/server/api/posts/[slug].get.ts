import { createError } from 'h3';
import { runTask } from 'laikacms/compat';

import { laika } from '../../utils/laika';

/**
 * GET /api/posts/:slug — fetch a single published post by slug.
 *
 * Reads the document via laika.documents.getDocument using runTask from
 * laikacms/compat (Promise-friendly, no Effect import needed).
 */
export default defineEventHandler(async event => {
  const { slug } = event.context.params as { slug: string };

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch {
    throw createError({ statusCode: 404, statusMessage: 'Post not found' });
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
});
