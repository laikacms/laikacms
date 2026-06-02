import { GraphQLScalarType, Kind } from 'graphql';
import { createSchema } from 'graphql-yoga';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.js';

export const schema = createSchema({
  typeDefs: /* GraphQL */ `
    """A published blog post — corresponds to a published Document in LaikaCMS."""
    type Post {
      slug: String!
      key: String!
      title: String
      date: String
      body: String
      """The raw content object from the underlying document."""
      content: JSON
    }

    """An unpublished (draft) document. Same shape as Post but with a status."""
    type Draft {
      slug: String!
      key: String!
      status: String!
      title: String
      body: String
      content: JSON
    }

    """Arbitrary JSON for raw content access."""
    scalar JSON

    type Query {
      """List published posts in a folder (default: posts)."""
      posts(folder: String = "posts", limit: Int = 100): [Post!]!
      """Get a single published post by slug (under posts/<slug>)."""
      post(slug: String!): Post
    }

    type Mutation {
      """Create a new draft post under posts/<slug>."""
      createDraft(slug: String!, title: String!, body: String!): Draft!
      """Publish an existing draft."""
      publish(slug: String!): Post!
    }
  `,
  resolvers: {
    JSON: new GraphQLScalarType({
      name: 'JSON',
      serialize: v => v,
      parseValue: v => v,
      parseLiteral: ast => (ast.kind === Kind.STRING ? ast.value : null),
    }),
    Query: {
      posts: async (_parent, args: { folder?: string, limit?: number }) => {
        const { items } = await collectStream(
          laika.documents.listRecords({
            folder: args.folder ?? 'posts',
            depth: 1,
            pagination: { offset: 0, limit: args.limit ?? 100 },
            type: 'published',
          }),
        );
        return items
          .filter(i => i.type === 'published')
          .map(item => {
            const content = ((item as { content?: Record<string, unknown> }).content ?? {}) as Record<
              string,
              unknown
            >;
            const key = (item as { key: string }).key;
            const slug = key.replace(/^posts\//, '').replace(/\.md$/, '');
            return {
              slug,
              key,
              title: (content.title as string) ?? null,
              date: (content.date as string) ?? null,
              body: (content.body as string) ?? null,
              content,
            };
          });
      },
      post: async (_parent, { slug }: { slug: string }) => {
        try {
          const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
          const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
            string,
            unknown
          >;
          return {
            slug,
            key: `posts/${slug}`,
            title: (content.title as string) ?? null,
            date: (content.date as string) ?? null,
            body: (content.body as string) ?? null,
            content,
          };
        } catch (err) {
          if (err instanceof NotFoundError) return null;
          throw err;
        }
      },
    },
    Mutation: {
      createDraft: async (
        _parent,
        { slug, title, body }: { slug: string, title: string, body: string },
      ) => {
        const draft = await runTask(
          laika.documents.createUnpublished({
            key: `posts/${slug}`,
            status: 'draft',
            language: 'en' as never,
            content: { title, body, date: new Date().toISOString() } as never,
          } as never),
        );
        const content = ((draft as { content?: Record<string, unknown> }).content ?? {}) as Record<
          string,
          unknown
        >;
        return {
          slug,
          key: `posts/${slug}`,
          status: 'draft',
          title: (content.title as string) ?? null,
          body: (content.body as string) ?? null,
          content,
        };
      },
      publish: async (_parent, { slug }: { slug: string }) => {
        const doc = await runTask(laika.documents.publish(`posts/${slug}`));
        const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
          string,
          unknown
        >;
        return {
          slug,
          key: `posts/${slug}`,
          title: (content.title as string) ?? null,
          date: (content.date as string) ?? null,
          body: (content.body as string) ?? null,
          content,
        };
      },
    },
  },
});
