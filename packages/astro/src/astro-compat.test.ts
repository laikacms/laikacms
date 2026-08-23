/**
 * Type-level guards that this package still fits Astro's contracts.
 *
 * These assertions live in a test rather than in `src/mapping.ts` on purpose.
 * Comparing `LaikaLoader` against Astro's `Loader` drags in `LoaderContext` and
 * with it the whole `AstroConfig` — cheap here, where exactly one copy of Astro
 * is installed, but the source of an "Excessive stack depth" error in a
 * consumer whose Astro version differs from the one we built against. Keeping
 * the check here proves the narrowing is sound without shipping the cost.
 */

import type { Loader, LoaderContext } from 'astro/loaders';
import { expectTypeOf, it } from 'vitest';

import { documentsLoader } from './documents-loader.js';
import type { LaikaLoader, LaikaLoaderContext } from './mapping.js';
import { objectsLoader } from './objects-loader.js';

it('documentsLoader produces a valid Astro Loader', () => {
  expectTypeOf(documentsLoader()).toExtend<Loader>();
});

it('objectsLoader produces a valid Astro Loader', () => {
  expectTypeOf(objectsLoader()).toExtend<Loader>();
});

it('a LaikaLoader is accepted wherever an Astro Loader is', () => {
  expectTypeOf<LaikaLoader>().toExtend<Loader>();
});

it('Astro supplies everything the narrowed loader context asks for', () => {
  // The narrowing is only safe while Astro's real context still satisfies it.
  expectTypeOf<LoaderContext>().toExtend<LaikaLoaderContext>();
});
