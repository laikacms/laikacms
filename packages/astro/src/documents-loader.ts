/**
 * The Content Layer loader for Laika documents.
 *
 * A Laika document key is `<collection>/<rest>`, and an Astro collection maps
 * onto that first segment — so `defineCollection` under the name `posts` reads
 * every published document under `posts/` with no further configuration.
 */

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError } from 'laikacms/core/errors';
import type { DocumentsRepository } from 'laikacms/documents';

import type { JSONSchema7 } from 'json-schema';
import type { CatalogProvider } from 'laikacms/catalog';

import { inferTypeScript } from './infer-types.js';
import { jsonSchemaToTypeScript, renderEntryModule } from './json-schema-to-types.js';
import { jsonSchemaToZod, type ZodNamespace } from './json-schema-to-zod.js';
import {
  DEFAULT_BODY_FIELD,
  entryIdOf,
  type EntryOptions,
  type LaikaLoader,
  type LaikaLoaderContext,
  type RenderOptions,
  type SourceRecord,
  stripBodyField,
  toDataEntry,
} from './mapping.js';
import { type LaikaRepositoryOptions, resolveCatalogProvider, resolveRepositories } from './repositories.js';
import { type KeyChange, runSync, type SyncOptions, type SyncSource } from './sync.js';

/** Pagination shapes the repositories accept; re-declared to keep Effect types out of the API. */
export interface LoaderPagination {
  page?: number;
  perPage?: number;
  offset?: number;
  limit?: number;
}

export interface DocumentSelectOptions {
  /** A sub-folder inside the collection. Omit to read the whole collection. */
  folder?: string;
  /** How many levels below the folder to descend. Defaults to 64 — effectively "all". */
  depth?: number;
  /** Which publication state to read. Defaults to `'published'`. */
  type?: 'published' | 'unpublished';
  /** Restrict to these unpublished statuses. Only meaningful with `type: 'unpublished'`. */
  statuses?: string[];
  /** Keep only documents in this language. */
  language?: string;
  /** Page size used while draining the listing. Defaults to `{ perPage: 1000 }`. */
  pagination?: LoaderPagination;
}

export interface DocumentsLoaderOptions extends LaikaRepositoryOptions {
  /**
   * The documents repository to read. Highest precedence — when given, no
   * repository is constructed and the rest of {@link LaikaRepositoryOptions} is
   * ignored. This is how you read from a remote Laika server: pass a
   * `DocumentsJsonApiProxyRepository`.
   */
  documents?: DocumentsRepository;
  /** The Laika collection key. Defaults to the Astro collection name. */
  collection?: string;
  select?: DocumentSelectOptions;
  entry?: EntryOptions;
  render?: RenderOptions;
  sync?: SyncOptions;
  /**
   * The `z` from `astro:content`.
   *
   * Supplying it — together with an explicit {@link collection} and a catalog
   * that can describe the collection's fields — lets the loader derive the
   * collection schema from the catalog instead of you restating it here. Astro
   * also generates entry types from it, so `entry.data` stays fully typed.
   *
   * Omit it and the collection is unvalidated unless you pass your own `schema`
   * to `defineCollection`.
   */
  z?: ZodNamespace;
  /** Astro project root, for resolving a relative `dir` before `load` runs. */
  root?: string;
  /** Loader name, which is what `refreshContent({ loaders })` targets. Defaults to `'laikacms'`. */
  name?: string;
}

export const DEFAULT_LOADER_NAME = 'laikacms';
const DEFAULT_DEPTH = 64;
const DEFAULT_PER_PAGE = 1000;

/** A Content Layer loader over a Laika {@link DocumentsRepository}. */
export function documentsLoader(options: DocumentsLoaderOptions = {}): LaikaLoader {
  return {
    name: options.name ?? DEFAULT_LOADER_NAME,
    // Only offered when it can actually be answered. Astro treats the presence
    // of `createSchema` as a promise that a schema exists, and a collection
    // whose name is not known until `load` runs cannot be described ahead of it.
    ...(options.z !== undefined && options.collection !== undefined
      ? {
        createSchema: () =>
          createSchemaFor(options as DocumentsLoaderOptions & { z: ZodNamespace, collection: string }),
      }
      : {}),
    load: async (context: LaikaLoaderContext) => {
      const collection = options.collection ?? context.collection;
      const documents = options.documents
        ?? resolveRepositories(options, context.config.root.pathname).documents;

      const entry = options.entry ?? {};
      const render = options.render ?? {};
      let warnedAboutDeferred = false;

      const source = createDocumentsSyncSource(documents, collection, options.select ?? {});

      await runSync(source, {
        collection,
        store: context.store,
        meta: context.meta,
        logger: context.logger,
        entry,
        generateDigest: context.generateDigest,
        refreshContextData: context.refreshContextData,
        toEntry: record =>
          toDataEntry(record, {
            collection,
            entry,
            render,
            renderMarkdown: context.renderMarkdown,
            generateDigest: context.generateDigest,
            parseData: context.parseData,
            addModuleImport: fileName => context.store.addModuleImport(fileName),
            onDeferredUnavailable: () => {
              if (warnedAboutDeferred) return;
              warnedAboutDeferred = true;
              context.logger.warn(
                'render.mode is "deferred" but render.filePath returned no path. '
                  + 'Deferred rendering needs an on-disk file; rendering markdown eagerly instead.',
              );
            },
          }),
      }, options.sync ?? {});
    },
  };
}

/** Adapt a {@link DocumentsRepository} to the seam the sync tiers work through. */
export function createDocumentsSyncSource(
  documents: DocumentsRepository,
  collection: string,
  select: DocumentSelectOptions,
): SyncSource {
  const folder = select.folder ? `${collection}/${select.folder}` : collection;
  const type = select.type ?? 'published';
  const summaryType = type === 'published' ? 'published-summary' : 'unpublished-summary';
  const listOptions = {
    folder,
    depth: select.depth ?? DEFAULT_DEPTH,
    type,
    pagination: select.pagination ?? { perPage: DEFAULT_PER_PAGE },
    ...(select.statuses !== undefined ? { statuses: select.statuses } : {}),
  };

  const matchesLanguage = (language: string): boolean => select.language === undefined || language === select.language;

  const read = async (key: string): Promise<SourceRecord | undefined> => {
    try {
      const document = type === 'published'
        ? await runTask(documents.getDocument(key))
        : await runTask(documents.getUnpublished(key));
      if (!matchesLanguage(document.language)) return undefined;
      return { key, content: document.content ?? {}, version: document.version };
    } catch (error) {
      // A key can vanish between being listed and being read — a change feed
      // reports it, another process deletes it, we read it. That is a normal
      // race, not a build failure; the caller drops the entry.
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  };

  return {
    capabilities: async () => {
      const caps = await runTask(documents.getCapabilities());
      return {
        changes: caps.changes.supported === true
          && caps.changes.syncToken === true
          && caps.changes.changeFeed === true,
        versions: caps.versionTracking.supported === true,
      };
    },

    listSummaries: async () => {
      const { items } = await collectStream(documents.listRecordSummaries(listOptions));
      return items
        .filter(item => item.type === summaryType)
        .filter(item => matchesLanguage((item as { language: string }).language))
        .map(item => ({ key: item.key, version: (item as { version?: string }).version }));
    },

    listRecords: async () => {
      const { items } = await collectStream(documents.listRecords(listOptions));
      const records: SourceRecord[] = [];
      for (const item of items) {
        if (item.type !== type) continue;
        const record = item as { key: string, content?: Record<string, unknown>, language: string, version?: string };
        if (!matchesLanguage(record.language)) continue;
        records.push({ key: record.key, content: record.content ?? {}, version: record.version });
      }
      return records;
    },

    getRecord: read,

    getSyncToken: async () => {
      const token = await runTask(documents.getSyncToken({ folder }));
      return String(token);
    },

    listChanges: async token => {
      const { items, done } = await collectStream(
        documents.listChanges({ since: token as never, folder }),
      );
      const changes: KeyChange[] = items.map(item => ({ key: item.key, deleted: item.deleted }));
      return { changes, syncToken: String(done.syncToken) };
    },

    // Strictly inside the folder. The folder key itself names a directory,
    // not a document, and a recursive filesystem watch reports directories
    // alongside files.
    ownsKey: key => key.startsWith(`${folder}/`),
  };
}

/** Re-exported so callers can derive an id the same way the loader does. */
export { entryIdOf };

/**
 * Derive one collection's schema and entry types from the catalog.
 *
 * The body field is removed first: the loader puts prose on `entry.body` and
 * `entry.rendered`, never in `data`, so a schema that still required it would
 * reject every entry.
 */
async function createSchemaFor(
  options: DocumentsLoaderOptions & { z: ZodNamespace, collection: string },
): Promise<{ schema: unknown, types: string }> {
  const repositories = options.repositories
    ?? resolveRepositories(options, options.root ?? process.cwd());
  const catalog = resolveCatalogProvider(
    options.catalog ?? 'convention',
    repositories.storage,
    options.configKey,
  );

  const bodyField = options.render?.bodyField ?? DEFAULT_BODY_FIELD;
  const jsonSchema = await describesFields(catalog, options.collection);

  if (jsonSchema !== undefined) {
    const withoutBody = stripBodyField(jsonSchema, bodyField);
    return {
      schema: jsonSchemaToZod(withoutBody, options.z),
      types: jsonSchemaToTypeScript(withoutBody, options.collection),
    };
  }

  // No field list to derive from — a convention catalog, or a CMS config that
  // does not describe this collection. Describe what is actually stored
  // instead, so a template still gets real types rather than `unknown`.
  const source = createDocumentsSyncSource(
    options.documents ?? repositories.documents,
    options.collection,
    options.select ?? {},
  );
  const records = await source.listRecords();
  const shapes = records.map(record => {
    const { [bodyField]: _body, ...rest } = record.content;
    return rest;
  });

  return {
    // Permissive, and deliberately `looseObject`: a plain `z.object({})` strips
    // every key it does not declare, which would empty `entry.data` outright.
    // Inferred types describe the content, they do not constrain it.
    schema: options.z.looseObject({}),
    types: renderEntryModule(inferTypeScript(shapes), {
      collection: options.collection,
      source: 'content',
    }),
  };
}

/**
 * The catalog's field list for a collection, or `undefined` when it has none.
 *
 * A convention catalog answers every collection with an empty, fully permissive
 * schema. Treating that as a description would produce `Record<string, unknown>`
 * and no validation — strictly worse than looking at the content.
 */
async function describesFields(
  catalog: CatalogProvider,
  collection: string,
): Promise<JSONSchema7 | undefined> {
  try {
    const schema = await runTask(catalog.getCollectionSchema(collection));
    const properties = schema.properties ?? {};
    return Object.keys(properties).length > 0 ? schema : undefined;
  } catch {
    return undefined;
  }
}
