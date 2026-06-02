import { runTask } from 'laikacms/compat';

import { makeLaika } from '../../utils/laika';

export default defineEventHandler(async event => {
  const slug = getRouterParam(event, 'slug');
  if (!slug) throw createError({ statusCode: 400 });

  const { DB } = event.context.cloudflare.env;
  const laika = makeLaika(DB);

  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    return doc.content;
  } catch {
    throw createError({ statusCode: 404, message: 'Post not found' });
  }
});
