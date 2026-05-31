import { initTRPC, TRPCError } from '@trpc/server';
import { collectStream, runTask } from 'laikacms/compat';
import { z } from 'zod';

import { laika } from './laika.js';

const t = initTRPC.create();

/**
 * Zod schema for the blog post content fields as defined in decap-config.ts.
 *
 * laika.documents.getDocument returns `Document` where `content` is
 * `Record<string, unknown>`. tRPC requires explicit output types; using Zod here
 * gives us both runtime validation and TypeScript inference from a single source.
 *
 * Doc gap: there is currently no way to derive this Zod schema automatically from
 * the Decap collection definition — you must duplicate field names here. A future
 * LaikaCMS helper (e.g. `zodSchemaFromCollection(blogCollections[0])`) would
 * eliminate the duplication.
 */
const PostSchema = z.object({
  slug: z.string(),
  title: z.string().optional(),
  date: z.string().optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  updatedAt: z.string().optional(),
});

const PostSummarySchema = z.object({
  slug: z.string(),
  updatedAt: z.string().optional(),
});

type PostSummary = z.infer<typeof PostSummarySchema>;
type Post = z.infer<typeof PostSchema>;

function slugFromKey(key: string): string {
  return key.replace(/^posts\//, '').replace(/\.md$/, '');
}

export const appRouter = t.router({
  /**
   * List all published post summaries, most-recent first.
   * Uses collectStream from laikacms/compat — no Effect knowledge required.
   */
  posts: t.procedure.output(z.array(PostSummarySchema)).query(async (): Promise<PostSummary[]> => {
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
  }),

  /**
   * Fetch a single post by slug.
   * Uses runTask from laikacms/compat. Throws NOT_FOUND when the document
   * doesn't exist (laika throws a LaikaError which we catch and re-throw).
   */
  post: t.procedure
    .input(z.object({ slug: z.string() }))
    .output(PostSchema)
    .query(async ({ input }): Promise<Post> => {
      try {
        const doc = await runTask(laika.documents.getDocument(`posts/${input.slug}`));
        // doc.content is Record<string, unknown> — parse + validate with Zod.
        // This converts the untyped content into a fully-typed Post at runtime.
        const content = PostSchema.omit({ slug: true, updatedAt: true }).parse(doc.content);
        return { slug: input.slug, updatedAt: doc.updatedAt, ...content };
      } catch (err) {
        if (err instanceof Error && err.message.includes('not found')) {
          throw new TRPCError({ code: 'NOT_FOUND', message: `Post "${input.slug}" not found` });
        }
        throw err;
      }
    }),
});

export type AppRouter = typeof appRouter;
