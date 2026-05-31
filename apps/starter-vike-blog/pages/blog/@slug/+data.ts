/**
 * Server-side data loader for individual blog posts.
 *
 * `pageContext.routeParams.slug` is provided by Vike's file-system router.
 * The `@slug` directory name tells Vike to treat the path segment as a
 * dynamic parameter.
 */
import { runTask } from 'laikacms/compat';
import { LaikaError } from 'laikacms/core';
import { render } from 'vike/abort';

import { laika } from '../../../src/laika.js';

interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

export interface PostData {
  slug: string;
  title: string;
  date: string | undefined;
  description: string | undefined;
  body: string | undefined;
}

export async function data(pageContext: { routeParams: { slug: string } }) {
  const { slug } = pageContext.routeParams;

  let post;
  try {
    post = await runTask(laika.documents.getDocument(`posts/${slug}`));
  } catch (err) {
    if (err instanceof LaikaError) throw render(404);
    throw err;
  }

  const content = post.content as PostContent;

  return {
    slug,
    title: content.title ?? slug,
    date: content.date,
    description: content.description,
    body: content.body,
  } satisfies PostData;
}

export type Data = PostData;
