/**
 * The live-collection type channel, checked at the type level.
 *
 * These assertions are the whole point of the feature: `entry.data` is typed
 * only if the augmentation the integration writes actually reaches the
 * `LiveLoader` generic. `vitest.config.ts` turns on `typecheck`, so a
 * regression here fails the suite rather than silently going back to
 * `Record<string, unknown>`.
 */

import type { LiveLoader } from 'astro/loaders';
import { expectTypeOf, it } from 'vitest';

import type { LaikaCollectionFilter, LaikaEntryFilter } from './live-loader.js';
import { liveDocumentsLoader } from './live-loader.js';

// Exactly what the integration emits into `.astro/`, against the module that
// declares the interface — a re-export is an alias, not a declaration, so this
// specifier is the one that merges.
declare module './live-collections.js' {
  interface LaikaLiveCollections {
    posts: { title: string, draft?: boolean };
  }
}

type DataOf<L> = L extends LiveLoader<infer D, LaikaEntryFilter, LaikaCollectionFilter, infer _E> ? D
  : never;

const documents = undefined as never;

it('types a collection the augmentation describes', () => {
  const _loader = liveDocumentsLoader({ documents, collection: 'posts' });

  expectTypeOf<DataOf<typeof _loader>>().toEqualTypeOf<{ title: string, draft?: boolean }>();
});

it('falls back to an open record for a collection nothing describes', () => {
  const _loader = liveDocumentsLoader({ documents, collection: 'unknown-collection' });

  expectTypeOf<DataOf<typeof _loader>>().toEqualTypeOf<Record<string, unknown>>();
});

it('falls back when the collection is only known at runtime', () => {
  // No `collection`: the key is the Astro collection name, which this call site
  // cannot see.
  const _loader = liveDocumentsLoader({ documents });

  expectTypeOf<DataOf<typeof _loader>>().toEqualTypeOf<Record<string, unknown>>();
});
