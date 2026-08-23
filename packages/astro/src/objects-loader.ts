/**
 * The Content Layer loader for Laika storage objects.
 *
 * This is the counterpart to {@link documentsLoader} for content that has no
 * publication state — site settings, navigation, a table of feature rows. It is
 * a separate loader rather than a `namespace` option because the difference is
 * not cosmetic: a storage object has no published/unpublished split, no status,
 * and no language, so a shared options struct would carry three fields that are
 * meaningless on half its inputs.
 */

import { collectStream, runTask } from 'laikacms/compat';
import { NotFoundError, NotImplementedError } from 'laikacms/core/errors';
import type { StorageRepository } from 'laikacms/storage';

import type { LoaderPagination } from './documents-loader.js';
import { inferTypeScript } from './infer-types.js';
import { renderEntryModule } from './json-schema-to-types.js';
import type { ZodNamespace } from './json-schema-to-zod.js';
import {
  DEFAULT_BODY_FIELD,
  type EntryOptions,
  type LaikaLoader,
  type LaikaLoaderContext,
  type RenderOptions,
  type SourceRecord,
  toDataEntry,
} from './mapping.js';
import { type LaikaRepositoryOptions, resolveRepositories } from './repositories.js';
import { runSync, type SyncSource } from './sync.js';

/**
 * Storage exposes no pull change feed and no version tokens — only a push
 * subscription, which the integration already forwards. So the tiers that
 * depend on either are not offered here rather than being offered and always
 * declined.
 */
export interface ObjectsSyncOptions {
  strategy?: 'auto' | 'digest' | 'reload';
}

export interface ObjectSelectOptions {
  /** The storage folder to read. Defaults to the Astro collection name. */
  folder?: string;
  /** How many levels below the folder to descend. Defaults to 64. */
  depth?: number;
  /** Page size used while draining the listing. Defaults to `{ perPage: 1000 }`. */
  pagination?: LoaderPagination;
}

export interface ObjectsLoaderOptions extends LaikaRepositoryOptions {
  /** The storage repository to read. Highest precedence. */
  storage?: StorageRepository;
  select?: ObjectSelectOptions;
  entry?: EntryOptions;
  render?: RenderOptions;
  sync?: ObjectsSyncOptions;
  /**
   * The `z` from `astro:content`.
   *
   * Storage objects have no catalog fields to derive a schema from, so
   * supplying `z` — together with an explicit `select.folder` — makes the loader
   * describe the objects it actually finds and hand Astro the resulting types.
   * `entry.data` is then typed instead of `unknown`.
   *
   * The schema stays permissive: these types report what the content contains,
   * they do not constrain what it may contain.
   */
  z?: ZodNamespace;
  /** Astro project root, for resolving a relative `dir` before `load` runs. */
  root?: string;
  /** Loader name, which is what `refreshContent({ loaders })` targets. */
  name?: string;
}

const DEFAULT_DEPTH = 64;
const DEFAULT_PER_PAGE = 1000;

/** A Content Layer loader over a Laika {@link StorageRepository}. */
export function objectsLoader(options: ObjectsLoaderOptions = {}): LaikaLoader {
  return {
    name: options.name ?? 'laikacms:objects',
    // Astro asks for the schema before `load` runs, so the folder cannot be
    // defaulted from the collection name here — it has to be given.
    ...(options.z !== undefined && options.select?.folder !== undefined
      ? {
        createSchema: () =>
          createSchemaFor(
            options as ObjectsLoaderOptions & {
              z: ZodNamespace,
              select: ObjectSelectOptions & { folder: string },
            },
          ),
      }
      : {}),
    load: async (context: LaikaLoaderContext) => {
      const folder = options.select?.folder ?? context.collection;
      const storage = options.storage
        ?? resolveRepositories(options, context.config.root.pathname).storage;

      const entry = options.entry ?? {};
      const render = options.render ?? {};

      const source = createObjectsSyncSource(storage, folder, options.select ?? {});

      await runSync(source, {
        // The folder is this source's key prefix, so it plays the role the
        // collection plays for documents: it is what entry ids are relative to.
        collection: folder,
        store: context.store,
        meta: context.meta,
        logger: context.logger,
        entry,
        generateDigest: context.generateDigest,
        refreshContextData: context.refreshContextData,
        toEntry: record =>
          toDataEntry(record, {
            collection: folder,
            entry,
            render,
            renderMarkdown: context.renderMarkdown,
            generateDigest: context.generateDigest,
            parseData: context.parseData,
            addModuleImport: fileName => context.store.addModuleImport(fileName),
          }),
      }, options.sync ?? {});
    },
  };
}

/** Adapt a {@link StorageRepository} to the seam the sync tiers work through. */
export function createObjectsSyncSource(
  storage: StorageRepository,
  folder: string,
  select: ObjectSelectOptions,
): SyncSource {
  const listOptions = {
    depth: select.depth ?? DEFAULT_DEPTH,
    pagination: select.pagination ?? { perPage: DEFAULT_PER_PAGE },
  };

  const read = async (key: string): Promise<SourceRecord | undefined> => {
    try {
      const object = await runTask(storage.getObject(key));
      return { key, content: object.content ?? {} };
    } catch (error) {
      if (error instanceof NotFoundError) return undefined;
      throw error;
    }
  };

  const unsupported = (method: string) => (): never => {
    throw new NotImplementedError(
      `${method} is not available for storage objects: a StorageRepository exposes no pull `
        + 'change feed. This should be unreachable — capabilities() reports both tiers as absent.',
    );
  };

  return {
    // Storage tracks neither versions nor a pull feed, so both optional tiers
    // are always absent and `auto` resolves to `digest`.
    capabilities: async () => ({ changes: false, versions: false }),

    listSummaries: async () => {
      const { items } = await collectStream(storage.listAtomSummaries(folder, listOptions));
      return items
        .filter(item => item.type === 'object-summary')
        .map(item => ({ key: item.key, version: undefined }));
    },

    listRecords: async () => {
      const { items } = await collectStream(storage.listAtoms(folder, listOptions));
      return items
        .filter(item => item.type === 'object')
        .map(item => ({
          key: item.key,
          content: (item as { content?: Record<string, unknown> }).content ?? {},
        }));
    },

    getRecord: read,
    getSyncToken: unsupported('getSyncToken'),
    listChanges: unsupported('listChanges'),

    // Strictly inside the folder. The folder key itself names a directory,
    // not an object, and a recursive filesystem watch reports directories
    // alongside files.
    ownsKey: key => key.startsWith(`${folder}/`),
  };
}

/**
 * Describe the objects in a folder, so a template gets real types.
 *
 * There is no field list anywhere for storage objects — that is the whole
 * difference between them and documents — so the content is the only available
 * description of itself.
 */
async function createSchemaFor(
  options: ObjectsLoaderOptions & { z: ZodNamespace, select: ObjectSelectOptions & { folder: string } },
): Promise<{ schema: unknown, types: string }> {
  const storage = options.storage
    ?? options.repositories?.storage
    ?? resolveRepositories(options, options.root ?? process.cwd()).storage;

  const source = createObjectsSyncSource(storage, options.select.folder, options.select);
  const records = await source.listRecords();
  const bodyField = options.render?.bodyField ?? DEFAULT_BODY_FIELD;
  const shapes = records.map(record => {
    const { [bodyField]: _body, ...rest } = record.content;
    return rest;
  });

  return {
    // See documents-loader: `z.object({})` would strip every key.
    schema: options.z.looseObject({}),
    types: renderEntryModule(inferTypeScript(shapes), {
      collection: options.select.folder,
      source: 'content',
    }),
  };
}
