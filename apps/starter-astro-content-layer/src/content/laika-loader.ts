import type { Loader } from 'astro/loaders';
import { collectStream } from 'laikacms/compat';

import { laika } from '../lib/laika.js';

/**
 * Astro Content Layer loader that pulls published posts from LaikaCMS.
 *
 * Uses laika.documents.listRecords() directly — no HTTP round-trip.
 * Each call to store.set() makes the post available as a typed Astro
 * content entry (getEntry / getCollection in .astro pages).
 *
 * The loader re-runs whenever Astro refreshes the content store:
 * during the build and on each hot-reload in dev mode.
 */
export function laikaPostsLoader(): Loader {
  return {
    name: 'laikacms-posts',
    async load({ store, logger }) {
      logger.info('Fetching posts from LaikaCMS...');

      const { items: records } = await collectStream(
        laika.documents.listRecords({
          pagination: { page: 1, perPage: 1000 },
          folder: 'posts',
          depth: 1,
          type: 'published',
        }),
      );

      store.clear();

      let count = 0;
      for (const record of records) {
        if (record.type !== 'published') continue;
        const slug = record.key.replace(/^posts\//, '').replace(/\.md$/, '');
        store.set({ id: slug, data: record.content as Record<string, unknown> });
        count++;
      }

      logger.info(`Loaded ${count} post(s) from LaikaCMS.`);
    },
  };
}
