import { initTRPC, TRPCError } from '@trpc/server';
import { z } from 'zod';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.js';

const t = initTRPC.create();

/**
 * Bare-bones tRPC router exposing the same surface as the GraphQL starter:
 *
 *   posts.list({ folder, limit })   → PostSummary[]
 *   posts.get({ slug })              → Post | null
 *   posts.createDraft({ slug, title, body }) → Draft
 *   posts.publish({ slug })          → Post
 *
 * Every procedure's input is validated with Zod. The output type is inferred
 * from the resolver's return — the client gets full end-to-end types
 * without a build step.
 */
export const appRouter = t.router({
  posts: t.router({
    list: t.procedure
      .input(z.object({ folder: z.string().default('posts'), limit: z.number().default(100) }))
      .query(async ({ input }) => {
        const { items } = await collectStream(
          laika.documents.listRecords({
            folder: input.folder,
            depth: 1,
            pagination: { offset: 0, limit: input.limit },
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
            return {
              key,
              slug: key.replace(/^posts\//, '').replace(/\.md$/, ''),
              title: (content.title as string) ?? null,
              date: (content.date as string) ?? null,
            };
          });
      }),

    get: t.procedure
      .input(z.object({ slug: z.string() }))
      .query(async ({ input }) => {
        try {
          const doc = await runTask(laika.documents.getDocument(`posts/${input.slug}`));
          const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
            string,
            unknown
          >;
          return {
            slug: input.slug,
            key: `posts/${input.slug}`,
            title: (content.title as string) ?? null,
            date: (content.date as string) ?? null,
            body: (content.body as string) ?? null,
            content,
          };
        } catch (err) {
          if (err instanceof NotFoundError) return null;
          throw err;
        }
      }),

    createDraft: t.procedure
      .input(z.object({ slug: z.string(), title: z.string(), body: z.string() }))
      .mutation(async ({ input }) => {
        const draft = await runTask(
          laika.documents.createUnpublished({
            key: `posts/${input.slug}`,
            status: 'draft',
            language: 'en' as never,
            content: { title: input.title, body: input.body, date: new Date().toISOString() } as never,
          } as never),
        );
        return {
          slug: input.slug,
          key: `posts/${input.slug}`,
          status: 'draft',
          title: input.title,
          body: input.body,
          content: (draft as { content?: unknown }).content,
        };
      }),

    publish: t.procedure
      .input(z.object({ slug: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const doc = await runTask(laika.documents.publish(`posts/${input.slug}`));
          const content = ((doc as { content?: Record<string, unknown> }).content ?? {}) as Record<
            string,
            unknown
          >;
          return {
            slug: input.slug,
            key: `posts/${input.slug}`,
            title: (content.title as string) ?? null,
            body: (content.body as string) ?? null,
          };
        } catch (err) {
          if (err instanceof NotFoundError) {
            throw new TRPCError({ code: 'NOT_FOUND', message: `posts/${input.slug} not found` });
          }
          throw err;
        }
      }),
  }),
});

/** Export the inferred type for the tRPC client. */
export type AppRouter = typeof appRouter;
