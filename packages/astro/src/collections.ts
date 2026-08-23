/**
 * Deriving Astro's content collections from the Laika catalog.
 *
 * Without this you declare every collection twice: once in the CMS config that
 * tells the editor what fields a post has, and again in `src/content.config.ts`
 * as a Zod schema. The two drift, and the drift shows up as a build failure
 * after someone edits the CMS config — the worst possible time.
 *
 * The catalog already knows both halves. `getCatalog()` enumerates the document
 * collections and their directories, and `getCollectionSchema()` returns each
 * one's fields as JSON Schema. So the CMS config can be the single source of
 * truth, and `content.config.ts` becomes one line.
 *
 * Nothing here knows what a CMS is. It asks a `CatalogProvider` — any provider —
 * to enumerate its collections and describe their fields. Reading those from a
 * Decap `config.yml` is one opt-in choice (`catalog: 'decap'`), on the same
 * footing as a persisted catalog or a provider you wrote yourself. The default
 * stays `'convention'`, as everywhere else in this package.
 */

import type { CatalogProvider, DocumentCollectionSettings } from 'laikacms/catalog';
import { runTask } from 'laikacms/compat';
import { BadRequestError } from 'laikacms/core/errors';

import { type DocumentSelectOptions, documentsLoader } from './documents-loader.js';
import { jsonSchemaToZod, type ZodNamespace, type ZodTypeLike } from './json-schema-to-zod.js';
import {
  DEFAULT_BODY_FIELD,
  type EntryOptions,
  type LaikaLoader,
  type RenderOptions,
  stripBodyField,
} from './mapping.js';
import { type LaikaRepositoryOptions, resolveCatalogProvider, resolveRepositories } from './repositories.js';
import type { SyncOptions } from './sync.js';

/** Per-collection overrides, keyed by collection name. */
export interface CollectionOverride {
  /**
   * Replace the derived schema. Pass your own Zod schema when the catalog's
   * fields do not capture a constraint you care about.
   */
  schema?: unknown;
  select?: DocumentSelectOptions;
  entry?: EntryOptions;
  render?: RenderOptions;
  sync?: SyncOptions;
}

export interface LaikaCollectionsOptions extends LaikaRepositoryOptions {
  /**
   * The `z` from `astro:content`. Supply it to derive a schema per collection
   * from the catalog's fields. Omit it and collections are created without a
   * schema — content still loads, it is just not validated.
   */
  z?: ZodNamespace;
  /**
   * Return `{}` instead of throwing when the catalog enumerates nothing.
   * Off by default: an empty `collections` export is almost always a
   * misconfiguration, and failing loudly beats a site that silently has no
   * content.
   */
  allowEmpty?: boolean;
  /** Only these collections. Defaults to every document collection in the catalog. */
  include?: string[];
  /** Skip these collections. */
  exclude?: string[];
  /** Applied to every collection; a per-collection override wins. */
  render?: RenderOptions;
  /** Per-collection overrides. */
  overrides?: Record<string, CollectionOverride>;
  /** Astro project root, for resolving a relative `dir`. Defaults to `process.cwd()`. */
  root?: string;
}

/** One entry of Astro's `collections` export. */
export interface AstroCollection {
  type: 'content_layer';
  loader: LaikaLoader;
  schema?: unknown;
}

/**
 * Build the `collections` object for `src/content.config.ts` from the catalog.
 *
 * ```ts
 * import { laikaCollections } from '@laikacms/astro/loader';
 * import { z } from 'astro:content';
 *
 * // `catalog: 'decap'` reads the collections out of your Decap config.yml.
 * // Any other CatalogProvider works the same way.
 * export const collections = await laikaCollections({ dir: 'content', catalog: 'decap', z });
 * ```
 */
export async function laikaCollections(
  options: LaikaCollectionsOptions = {},
): Promise<Record<string, AstroCollection>> {
  const root = options.root ?? process.cwd();
  const catalogChoice = options.catalog ?? 'convention';
  const repositories = resolveRepositories({ ...options, catalog: catalogChoice }, root);
  const catalog = resolveCatalogProvider(catalogChoice, repositories.storage, options.configKey);

  const names = await documentCollectionNames(catalog, options);
  if (names.length === 0 && options.allowEmpty !== true) {
    throw new BadRequestError(
      'laikaCollections found no document collections in the catalog. The convention catalog '
        + 'only reports collections that have been persisted, so if your collections are '
        + "declared in a Decap config.yml, pass catalog: 'decap'. Pass allowEmpty: true if an "
        + 'empty result is expected.',
    );
  }

  const collections: Record<string, AstroCollection> = {};
  for (const name of names) {
    const override = options.overrides?.[name] ?? {};
    const bodyField = override.render?.bodyField ?? options.render?.bodyField ?? DEFAULT_BODY_FIELD;
    const schema = override.schema ?? await deriveSchema(catalog, name, options.z, bodyField);

    collections[name] = {
      type: 'content_layer',
      loader: documentsLoader({
        ...options,
        catalog: catalogChoice,
        collection: name,
        // The loader must read through the same catalog, or a collection whose
        // directory differs from its name would be read from the wrong folder.
        repositories,
        ...(override.select !== undefined ? { select: override.select } : {}),
        ...(override.entry !== undefined ? { entry: override.entry } : {}),
        ...(override.render ?? options.render ? { render: override.render ?? options.render! } : {}),
        ...(override.sync !== undefined ? { sync: override.sync } : {}),
      }),
      ...(schema !== undefined ? { schema } : {}),
    };
  }

  return collections;
}

/** The document collections the catalog knows about, after include/exclude. */
async function documentCollectionNames(
  catalog: CatalogProvider,
  options: LaikaCollectionsOptions,
): Promise<string[]> {
  const { collections } = await runTask(catalog.getCatalog());
  const all = Object.entries(collections ?? {})
    .filter((pair): pair is [string, DocumentCollectionSettings] => pair[1].type === 'document')
    .map(([name]) => name);

  const included = options.include ? all.filter(name => options.include!.includes(name)) : all;
  return options.exclude ? included.filter(name => !options.exclude!.includes(name)) : included;
}

/**
 * Derive one collection's Zod schema.
 *
 * A catalog that cannot describe a collection's fields is not an error — it
 * means "no schema", and Astro is happy to load a collection without one.
 * Failing the build because the CMS config omits a field list would be a worse
 * outcome than not validating it.
 */
async function deriveSchema(
  catalog: CatalogProvider,
  collection: string,
  z: ZodNamespace | undefined,
  bodyField: string,
): Promise<ZodTypeLike | undefined> {
  if (z === undefined) return undefined;
  try {
    const jsonSchema = await runTask(catalog.getCollectionSchema(collection));
    return jsonSchemaToZod(stripBodyField(jsonSchema, bodyField), z);
  } catch {
    return undefined;
  }
}
