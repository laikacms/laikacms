import { z } from 'zod';

// Mirror the Decap collection field definitions with Zod schemas.
// doc.content is Record<string, unknown> so Zod is the natural fit for
// runtime validation + TypeScript inference from a single source of truth.

export const PostSchema = z.object({
  title: z.string().min(1),
  date: z.iso.datetime(),
  body: z.string().optional().default(''),
  draft: z.boolean().optional().default(false),
  tags: z.array(z.string()).optional().default([]),
});

export type Post = z.infer<typeof PostSchema>;

export const PostSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  date: z.iso.datetime(),
  draft: z.boolean().default(false),
});

export type PostSummary = z.infer<typeof PostSummarySchema>;
