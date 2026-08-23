/**
 * The live-collection loader — content read per request instead of per build.
 *
 * This is what makes draft preview possible. A build-time loader can only ever
 * show what was published when the site was built; a live loader reads the
 * repository while the request is in flight, so an editor can look at an
 * unpublished document without a rebuild.
 *
 * This module ships in the server bundle of every page that uses it, so it
 * imports nothing from `node:` and pulls in no markdown parser. Rendering is an
 * injected function, absent by default.
 */

import type { LiveLoader } from 'astro/loaders';
import type { CatalogProvider } from 'laikacms/catalog';
import { collectStream, runTask } from 'laikacms/compat';
import { BadRequestError, InternalError, LaikaError, NotFoundError, ValidationError } from 'laikacms/core/errors';
import type { DocumentsRepository } from 'laikacms/documents';

import type { LoaderPagination } from './documents-loader.js';
import { jsonSchemaToZod, type ZodNamespace } from './json-schema-to-zod.js';
import type { LiveCollectionData, LiveCollectionKey } from './live-collections.js';
import { DEFAULT_BODY_FIELD, entryIdOf, type EntryOptions, keyOf, splitContent, stripBodyField } from './mapping.js';

/** Identifies one document. Supply either the Astro entry id or the full Laika key. */
export interface LaikaEntryFilter {
  /**
   * The Astro entry id — the Laika key with the collection prefix removed.
   * `getLiveEntry(collection, 'some-id')` is normalised to this field, so it is
   * the one that makes the string shorthand work.
   */
  id?: string;
  /** The full Laika key. Takes precedence over {@link id}. */
  key?: string;
  /** Which publication state to read. Defaults to `'published'`. */
  type?: 'published' | 'unpublished';
  /** Which unpublished status to read. Only meaningful with `type: 'unpublished'`. */
  status?: string;
}

export interface LaikaCollectionFilter {
  folder?: string;
  depth?: number;
  type?: 'published' | 'unpublished';
  statuses?: string[];
  language?: string;
  pagination?: LoaderPagination;
}

export interface LiveRenderOptions {
  /** Defaults to `'none'`. `'markdown'` requires {@link markdown}. */
  mode?: 'markdown' | 'none';
  /** Which content field holds the prose. Defaults to `'body'`. */
  bodyField?: string;
  /**
   * Renders a body to HTML. Required for `mode: 'markdown'`.
   *
   * There is no default: bundling a markdown parser here would put it in the
   * server bundle of every page that reads a live collection, whether or not
   * that page renders prose.
   */
  markdown?: (body: string) => Promise<string>;
}

export interface LiveCacheOptions {
  /** Cache tags for an entry. Defaults to `['laika', 'laika:<collection>', 'laika:<key>']`. */
  tags?: (context: { key: string, collection: string }) => string[];
  /** Send `updatedAt` as the cache hint's `lastModified`. Defaults to `true`. */
  lastModified?: boolean;
}

/**
 * Validate live entries against the collection's catalog-derived schema.
 *
 * Off by default, and deliberately: a build-time collection is validated once
 * per build, but this runs on every request, and this module ships in the
 * server bundle of every page that reads a live collection. Turning it on is a
 * per-loader decision because the cost is per-loader.
 *
 * Both `catalog` and `z` are required when on. Neither is inferable here — the
 * loader is handed a repository, not the options that built one, and `z` has to
 * be the project's own `astro:content` import so there is exactly one Zod in
 * the build (the same reasoning as `jsonSchemaToZod`).
 */
export interface LiveValidateOptions {
  catalog: CatalogProvider;
  z: ZodNamespace;
}

export interface LiveDocumentsLoaderOptions {
  /**
   * The documents repository to read. Required — unlike the build-time loaders
   * there is no filesystem default, because this code may run on a runtime that
   * has no filesystem.
   */
  documents: DocumentsRepository;
  /** The Laika collection key. Defaults to the Astro collection name. */
  collection?: string;
  /** Defaults merged under the per-call filter. */
  select?: LaikaCollectionFilter;
  entry?: EntryOptions;
  render?: LiveRenderOptions;
  cache?: LiveCacheOptions;
  name?: string;
  /**
   * Reject entries that do not match the catalog's schema. Off by default; see
   * {@link LiveValidateOptions}.
   *
   * A failure surfaces as a `ValidationError` on the result's `error`, not a
   * throw, so a page can branch on `error.code` the same way it does for every
   * other failure this loader reports.
   */
  validate?: LiveValidateOptions;
}

const DEFAULT_DEPTH = 64;
const DEFAULT_PER_PAGE = 100;

type LiveEntry = {
  id: string,
  data: Record<string, unknown>,
  rendered?: { html: string },
  cacheHint?: { tags?: string[], lastModified?: Date },
};

/**
 * A live loader over a Laika {@link DocumentsRepository}.
 *
 * When `collection` names a collection the integration has typed (see
 * `live-collections.ts`), `entry.data` comes back as that collection's shape.
 * Otherwise — an untyped collection, or `collection` omitted so the key is only
 * known at runtime — it stays `Record<string, unknown>`.
 */
export function liveDocumentsLoader<K extends LiveCollectionKey>(
  options: LiveDocumentsLoaderOptions & { collection: K },
): LiveLoader<LiveCollectionData<K>, LaikaEntryFilter, LaikaCollectionFilter, LaikaError>;
export function liveDocumentsLoader(
  options: LiveDocumentsLoaderOptions,
): LiveLoader<Record<string, unknown>, LaikaEntryFilter, LaikaCollectionFilter, LaikaError>;
export function liveDocumentsLoader(
  options: LiveDocumentsLoaderOptions,
): LiveLoader<Record<string, unknown>, LaikaEntryFilter, LaikaCollectionFilter, LaikaError> {
  const entryOptions = options.entry ?? {};
  const renderOptions = options.render ?? {};
  const cacheOptions = options.cache ?? {};
  const validator = options.validate === undefined
    ? undefined
    : createValidator(options.validate, renderOptions.bodyField ?? DEFAULT_BODY_FIELD);

  const build = async (
    collection: string,
    record: { key: string, content: Record<string, unknown>, updatedAt?: string },
  ): Promise<LiveEntry> => {
    const id = entryIdOf(record.key, collection, entryOptions);
    const { data: raw, body } = splitContent(
      { key: record.key, content: record.content },
      { entry: entryOptions, render: { bodyField: renderOptions.bodyField } },
    );

    // Validation replaces `data` rather than only checking it: the derived Zod
    // schema coerces a date string to a Date, which is what makes the generated
    // types' `Date` half true when validation is on.
    const data = validator === undefined ? raw : await validator(collection, raw);

    const entry: LiveEntry = { id, data };

    if (renderOptions.mode === 'markdown' && body !== undefined && renderOptions.markdown) {
      entry.rendered = { html: await renderOptions.markdown(body) };
    }

    const tags = cacheOptions.tags?.({ key: record.key, collection })
      ?? ['laika', `laika:${collection}`, `laika:${record.key}`];
    const cacheHint: { tags?: string[], lastModified?: Date } = { tags };
    if (cacheOptions.lastModified !== false && record.updatedAt !== undefined) {
      const lastModified = new Date(record.updatedAt);
      if (!Number.isNaN(lastModified.getTime())) cacheHint.lastModified = lastModified;
    }
    entry.cacheHint = cacheHint;

    return entry;
  };

  return {
    name: options.name ?? 'laikacms:live',

    loadEntry: async ({ filter, collection: astroCollection }) => {
      const collection = options.collection ?? astroCollection;
      const key = filter.key ?? (filter.id !== undefined ? keyOf(filter.id, collection) : undefined);
      if (key === undefined) {
        return {
          error: new BadRequestError(
            'A live entry needs either an "id" or a "key". '
              + 'getLiveEntry(collection, "some-id") supplies "id" for you.',
          ),
        };
      }

      try {
        const type = filter.type ?? options.select?.type ?? 'published';
        const record = type === 'published'
          ? await runTask(options.documents.getDocument(key))
          : await runTask(options.documents.getUnpublished(key));

        // A caller previewing one status should not silently get another.
        if (filter.status !== undefined && (record as { status?: string }).status !== filter.status) {
          return undefined;
        }

        return await build(collection, {
          key,
          content: record.content ?? {},
          ...(record.updatedAt !== undefined ? { updatedAt: record.updatedAt } : {}),
        });
      } catch (error) {
        // Returning `undefined` lets Astro raise its own LiveEntryNotFoundError,
        // which is the shape callers already branch on.
        if (error instanceof NotFoundError) return undefined;
        return { error: toLaikaError(error) };
      }
    },

    loadCollection: async ({ filter, collection: astroCollection }) => {
      const collection = options.collection ?? astroCollection;
      const merged = { ...options.select, ...filter };
      const type = merged.type ?? 'published';

      try {
        const { items } = await collectRecords(options.documents, collection, merged, type);
        const entries: LiveEntry[] = [];
        for (const record of items) {
          entries.push(await build(collection, record));
        }
        return {
          entries,
          cacheHint: { tags: ['laika', `laika:${collection}`] },
        };
      } catch (error) {
        return { error: toLaikaError(error) };
      }
    },
  };
}

async function collectRecords(
  documents: DocumentsRepository,
  collection: string,
  filter: LaikaCollectionFilter,
  type: 'published' | 'unpublished',
): Promise<{ items: Array<{ key: string, content: Record<string, unknown>, updatedAt?: string }> }> {
  const folder = filter.folder ? `${collection}/${filter.folder}` : collection;
  const { items } = await collectStream(documents.listRecords({
    folder,
    depth: filter.depth ?? DEFAULT_DEPTH,
    type,
    pagination: filter.pagination ?? { perPage: DEFAULT_PER_PAGE },
    ...(filter.statuses !== undefined ? { statuses: filter.statuses } : {}),
  }));

  const records: Array<{ key: string, content: Record<string, unknown>, updatedAt?: string }> = [];
  for (const item of items) {
    if (item.type !== type) continue;
    const record = item as {
      key: string,
      content?: Record<string, unknown>,
      language: string,
      updatedAt?: string,
    };
    if (filter.language !== undefined && record.language !== filter.language) continue;
    records.push({
      key: record.key,
      content: record.content ?? {},
      ...(record.updatedAt !== undefined ? { updatedAt: record.updatedAt } : {}),
    });
  }
  return { items: records };
}

/**
 * Zod seen only as "a thing that parses".
 *
 * `ZodTypeLike` names `optional()` and nothing else, because that is all the
 * conversion needs; widening it here rather than there keeps the compatibility
 * boundary in one direction — this module knows it is holding a real Zod
 * schema, `json-schema-to-zod.ts` still does not have to.
 */
interface ParseCapable {
  parse(value: unknown): unknown;
}

/**
 * Build the per-collection validating parser.
 *
 * The schema is derived once per collection for the life of the process, not
 * once per request: the catalog read is I/O, and a live loader is constructed
 * once and then hit on every request that touches it.
 */
function createValidator(
  options: LiveValidateOptions,
  bodyField: string,
): (collection: string, data: Record<string, unknown>) => Promise<Record<string, unknown>> {
  const schemas = new Map<string, Promise<ParseCapable>>();

  const schemaFor = (collection: string): Promise<ParseCapable> => {
    let pending = schemas.get(collection);
    if (pending !== undefined) return pending;

    pending = runTask(options.catalog.getCollectionSchema(collection))
      .then(schema => jsonSchemaToZod(stripBodyField(schema, bodyField), options.z) as unknown as ParseCapable)
      .catch((error: unknown) => {
        // A failed read is not cached: a catalog that was briefly unreachable
        // must not leave this loader unvalidated for the rest of the process.
        schemas.delete(collection);
        // Deliberately not a NotFoundError, even when that is the cause —
        // `loadEntry` reads that as "no such entry" and returns `undefined`,
        // which would report a missing catalog as a missing document.
        throw new InternalError(
          `validate is on for live collection '${collection}', but its schema could not be read `
            + `from the catalog.`,
          { cause: error },
        );
      });

    schemas.set(collection, pending);
    return pending;
  };

  return async (collection, data) => {
    const schema = await schemaFor(collection);
    try {
      return schema.parse(data) as Record<string, unknown>;
    } catch (error) {
      throw new ValidationError(
        `A live entry in collection '${collection}' does not match the catalog's schema.`,
        { cause: error },
      );
    }
  };
}

/**
 * Astro wraps a *thrown* error in an opaque `LiveCollectionError`, which erases
 * the code, status and translation a `LaikaError` carries. Returning the error
 * instead keeps all of that reachable from the page, so a caller can branch on
 * `error.code` rather than parse a message.
 */
function toLaikaError(error: unknown): LaikaError {
  if (error instanceof LaikaError) return error;
  return new InternalError('The live loader failed to read from the repository.', {
    cause: error,
  });
}
