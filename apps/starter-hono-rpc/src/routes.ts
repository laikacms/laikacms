import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core';

import { laika } from './laika.js';

/**
 * Typed Hono routes. The trick: every route's `.get`/`.post`/etc. CALL
 * returns the Hono app instance with the route's types accumulated. So when
 * we `export type AppType = typeof rpc`, the client gets every route's
 * input/output shape for free — no codegen, no separate schema.
 *
 * Compare with tRPC:
 *   - tRPC: explicit procedure(input).query/mutation(handler).
 *   - Hono RPC: stock Hono routes + `zValidator` for input shape.
 *
 * Both end up at the same place — typed RPC over HTTP — but Hono RPC
 * piggybacks on the routing layer you'd already be writing.
 */
export const rpc = new Hono()
  .get('/posts', async c => {
    const { items } = await collectStream(
      laika.documents.listRecords({
        folder: 'posts',
        depth: 1,
        pagination: { offset: 0, limit: 100 },
        type: 'published',
      }),
    );
    return c.json({
      posts: items
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
        }),
    });
  })
  .get(
    '/posts/:slug',
    zValidator('param', z.object({ slug: z.string() })),
    async c => {
      const { slug } = c.req.valid('param');
      try {
        const doc = await runTask(laika.documents.getDocument(`posts/${slug}`));
        return c.json({ post: doc });
      } catch (err) {
        if (err instanceof NotFoundError) return c.json({ error: 'Not found' as const }, 404);
        throw err;
      }
    },
  )
  .post(
    '/posts',
    zValidator('json', z.object({ slug: z.string(), title: z.string(), body: z.string() })),
    async c => {
      const { slug, title, body } = c.req.valid('json');
      const draft = await runTask(
        laika.documents.createUnpublished({
          key: `posts/${slug}`,
          status: 'draft',
          language: 'en' as never,
          content: { title, body, date: new Date().toISOString() } as never,
        } as never),
      );
      return c.json({ draft });
    },
  )
  .post(
    '/posts/:slug/publish',
    zValidator('param', z.object({ slug: z.string() })),
    async c => {
      const { slug } = c.req.valid('param');
      try {
        const doc = await runTask(laika.documents.publish(`posts/${slug}`));
        return c.json({ post: doc });
      } catch (err) {
        if (err instanceof NotFoundError) return c.json({ error: 'Not found' as const }, 404);
        throw err;
      }
    },
  );

/** Export the type for the client side: `import type { AppType } from '...'`. */
export type AppType = typeof rpc;
