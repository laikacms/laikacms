import { defineCollection, z } from 'astro:content';

import { laikaPostsLoader } from './laika-loader.js';

export const collections = {
  posts: defineCollection({
    loader: laikaPostsLoader(),
    schema: z.object({
      title: z.string().optional(),
      date: z.string().optional(),
      description: z.string().optional(),
      body: z.string().optional(),
    }),
  }),
};
