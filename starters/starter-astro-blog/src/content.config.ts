/**
 * Content collections.
 *
 * The fields are declared once, in `content/config.yml`, where the CMS already
 * needs them. Passing `z` lets the loader derive this collection's schema from
 * that config — Astro validates against it and generates entry types from it, so
 * `post.data.title` is still fully typed without restating a single field here.
 *
 * `catalog: 'decap'` selects the Decap config as the source. Any other
 * `CatalogProvider` works the same way; nothing here is Decap-specific.
 *
 * Pass your own `schema` to `defineCollection` to take a collection back under
 * manual control — an explicit schema always wins over the derived one.
 */
import { documentsLoader } from '@laikacms/astro/loader';
import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  loader: documentsLoader({
    dir: 'content',
    defaultExtension: 'md',
    catalog: 'decap',
    collection: 'posts',
    z,
  }),
});

export const collections = { posts };
