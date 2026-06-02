import { error } from '@sveltejs/kit';
import { runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';

import { makeLaika } from '$lib/laika';

import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
  const laika = makeLaika(platform!.env.DB);
  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${params.slug}`));
  } catch (err) {
    if (err instanceof LaikaError) error(404, 'Post not found');
    throw err;
  }

  return {
    slug: params.slug,
    title: (post.content['title'] as string | undefined) ?? params.slug,
    date: (post.content['date'] as string | undefined) ?? null,
    description: (post.content['description'] as string | undefined) ?? null,
    body: (post.content['body'] as string | undefined) ?? '',
  };
};
