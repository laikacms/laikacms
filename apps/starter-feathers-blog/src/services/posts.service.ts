/**
 * Feathers posts service backed by LaikaCMS.
 *
 * This is the key integration pattern: a Feathers ServiceInterface wraps
 * laika.documents.* so any Feathers transport (REST, Socket.io) can query
 * CMS content through a typed, structured API.
 *
 * Doc note (ergonomics gap): laika.documents.getDocument returns doc.content
 * as Record<string, unknown>. For a typed Feathers service you must cast or
 * validate the content. A zodSchemaFromCollection() or TypeBox helper would
 * let you derive a typed schema directly from the Decap collection definition.
 *
 * Doc note: Feathers ServiceInterface does not include a built-in "list with
 * full content" operation — the two-step listSummaries + getDocument pattern
 * requires mapping twice. An alternative is a single collectStream call with
 * a higher depth parameter if LaikaCMS supports it in the future.
 */
import type { Id, Params } from '@feathersjs/feathers';

// Minimal feathers-style 404 — avoids the @feathersjs/errors dependency.
class NotFound extends Error {
  readonly code = 404;
  readonly className = 'not-found';
  constructor(message: string) {
    super(message);
    this.name = 'NotFound';
  }
}
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from '../lib/laika.js';

export interface Post {
  id: string;
  title: string;
  date: string | null;
  description: string | null;
  body: string | null;
  updatedAt: string | null;
}

export class PostsService {
  /** GET /posts — list all published posts */
  async find(_params?: Params): Promise<Post[]> {
    const { items: records } = await collectStream(
      laika.documents.listRecordSummaries({
        pagination: { page: 1, perPage: 100 },
        folder: 'posts',
        depth: 1,
        type: 'published',
      }),
    );

    const summaries = records.filter(r => r.type === 'published-summary');

    const posts = await Promise.all(
      summaries.map(async r => {
        const id = r.key.replace(/^posts\//, '').replace(/\.md$/, '');
        const doc = await runTask(laika.documents.getDocument(r.key));
        const content = doc.content as Partial<Post>;
        return {
          id,
          title: content.title ?? id,
          date: content.date ?? null,
          description: content.description ?? null,
          body: content.body ?? null,
          updatedAt: r.updatedAt ?? null,
        };
      }),
    );

    return posts.sort((a, b) => {
      if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
      return b.id.localeCompare(a.id);
    });
  }

  /** GET /posts/:id — fetch a single post by slug */
  async get(id: Id, _params?: Params): Promise<Post> {
    try {
      const doc = await runTask(laika.documents.getDocument(`posts/${String(id)}`));
      const content = doc.content as Partial<Post>;
      return {
        id: String(id),
        title: content.title ?? String(id),
        date: content.date ?? null,
        description: content.description ?? null,
        body: content.body ?? null,
        updatedAt: null,
      };
    } catch {
      throw new NotFound(`Post '${String(id)}' not found`);
    }
  }
}
