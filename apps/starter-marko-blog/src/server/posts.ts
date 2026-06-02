import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika';

export interface PostListItem {
  slug: string;
  title: string;
  date: string | null;
}

export async function listPosts(): Promise<PostListItem[]> {
  const { items } = await collectStream(
    laika.documents.listRecords({
      folder: 'posts',
      depth: 1,
      pagination: { offset: 0, limit: 100 },
      type: 'published',
    }),
  );
  return items
    .filter(item => item.type === 'published')
    .map(item => {
      const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
        string,
        unknown
      >;
      const slug = (item as { key: string }).key.replace(/^posts\//, '').replace(/\.md$/, '');
      return {
        slug,
        title: (content.title as string) ?? slug,
        date: (content.date as string) ?? null,
      };
    });
}

export interface PostDetail {
  title: string;
  body: string;
  date: string | null;
}

export async function getPost(slug: string): Promise<PostDetail | null> {
  try {
    const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
    const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
      string,
      unknown
    >;
    return {
      title: (content.title as string) ?? slug,
      body: (content.body as string) ?? '',
      date: (content.date as string) ?? null,
    };
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}
