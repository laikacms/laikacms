import type { HttpContext } from '@adonisjs/core/http';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from '#services/laika';

type PostContent = {
  title?: string,
  date?: string,
  description?: string,
  body?: string,
};

export default class PostsController {
  async index({ response }: HttpContext) {
    const { items } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const posts = items
      .filter((r: { type: string }) => r.type === 'published-summary')
      .sort((a: { key: string, updatedAt?: string }, b: { key: string, updatedAt?: string }) => {
        if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
        return b.key.localeCompare(a.key);
      })
      .map((r: { key: string, updatedAt?: string }) => ({
        slug: r.key.replace(/^posts\//, '').replace(/\.md$/, ''),
        updatedAt: r.updatedAt,
      }));

    return response.json(posts);
  }

  async show({ params, response }: HttpContext) {
    const { slug } = params;
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
      const content = doc.content as PostContent;
      return response.json({ slug, ...content });
    } catch {
      return response.status(404).json({ error: `Post '${slug}' not found` });
    }
  }
}
