import { createSchema } from 'graphql-yoga';
import { collectStream, runTask } from 'laikacms/compat';

import { laika } from './laika.js';

/**
 * The content field returned by laika.documents.getDocument is typed as
 * `Record<string, unknown>`. When writing GraphQL resolvers you must cast it to
 * the shape you configured in the Decap CMS collection — there is no compile-time
 * connection between the runtime CMS schema and TypeScript types yet.
 *
 * Doc gap: LaikaCMS could expose a generic parameter on Document.content so that
 * callers can pass `getDocument<PostContent>(key)` — tracked as a docs/types issue.
 */
interface PostContent {
  title?: string;
  date?: string;
  description?: string;
  body?: string;
}

function slugFromKey(key: string): string {
  return key.replace(/^posts\//, '').replace(/\.md$/, '');
}

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    """
    A full blog post with its content fields.
    Field names mirror the Decap CMS collection defined in decap-config.ts.
    """
    type Post {
      slug: String!
      title: String
      date: String
      description: String
      body: String
      updatedAt: String
    }

    """
    Lightweight summary returned by the list query — avoids loading full content.
    """
    type PostSummary {
      slug: String!
      updatedAt: String
    }

    type Query {
      "List all published post summaries, most-recent first."
      posts: [PostSummary!]!
      "Fetch a single post by slug. Returns null when not found."
      post(slug: String!): Post
    }
  `,

  resolvers: {
    Query: {
      posts: async () => {
        const { items } = await collectStream(
          laika.documents.listRecordSummaries({
            pagination: { page: 1, perPage: 100 },
            folder: 'posts',
            depth: 1,
            type: 'published',
          }),
        );

        return items
          .filter(r => r.type === 'published-summary')
          .map(r => ({ slug: slugFromKey(r.key), updatedAt: r.updatedAt }))
          .sort((a, b) => {
            if (a.updatedAt && b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
            return b.slug.localeCompare(a.slug);
          });
      },

      post: async (_: unknown, { slug }: { slug: string }) => {
        try {
          const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
          // Cast doc.content (Record<string, unknown>) to the collection-specific type.
          // This cast is safe because the content was written by Decap CMS using the
          // collection schema in decap-config.ts — but TypeScript cannot verify it.
          const { title, date, description, body } = doc.content as PostContent;
          return { slug, updatedAt: doc.updatedAt, title, date, description, body };
        } catch {
          return null;
        }
      },
    },
  },
});
