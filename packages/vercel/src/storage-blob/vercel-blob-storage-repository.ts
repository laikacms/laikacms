import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InternalError,
  InvalidData,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsDone,
  ListAtomsOptions,
  RemoveAtomsDone,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageSerializerRegistry,
} from 'laikacms/storage';
import {
  applyPagination,
  type Capabilities,
  CompatibilityDate,
  defaultDetermineExtension,
  type DetermineExtension,
  naturalCompare,
  pathCombine,
  StorageRepository,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import { VercelBlobDataSource, type VercelBlobListEntry } from './vercel-blob-datasource.js';

export interface VercelBlobStorageRepositoryOptions {
  /** Pre-configured data source — owns auth and the `fetch` implementation. */
  readonly dataSource: VercelBlobDataSource;
  /** Optional key prefix scoping every operation under a virtual subfolder. */
  readonly basePath?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/**
 * A {@link StorageRepository} backed by [Vercel Blob](https://vercel.com/docs/storage/vercel-blob).
 *
 * Vercel Blob is a hosted blob store — path-flat like S3, with two quirks
 * that shape the implementation:
 *
 *   - **No native delete-by-pathname.** Deletes go through `POST /delete`
 *     with the *URL* in the body, not the pathname. The repository therefore
 *     resolves keys → URLs via `list({prefix})`, then ships every URL in
 *     **one** `POST /delete` body, making `removeAtoms(N)` a single
 *     round-trip regardless of N.
 *   - **No delimiter parameter on list.** Unlike S3's `ListObjectsV2`
 *     `Delimiter: '/'`, Vercel Blob's list always returns deep-nested
 *     results. Subfolder grouping is reconstructed client-side from the
 *     pathname segment after the prefix.
 *
 * `addRandomSuffix=0` is hard-coded on every upload — Laika owns the key,
 * and a random suffix would break overwrite. Empty folders use `.keep`
 * placeholders, same as the S3/R2 implementations.
 */
export class VercelBlobStorageRepository extends StorageRepository {
  private readonly dataSource: VercelBlobDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly basePath: string;
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: VercelBlobStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      basePath = '',
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    this.dataSource = dataSource;
    this.basePath = stripSlashes(basePath);
    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((re): re is minimatch.MMRegExp => re !== false);
  }

  // ───────────────────── path / key plumbing ─────────────────────

  private fullPath(relativeKey: string): string {
    const base = this.basePath;
    const k = stripSlashes(relativeKey);
    return base === '' ? k : k === '' ? base : `${base}/${k}`;
  }

  private relativePath(fullKey: string): string {
    const base = this.basePath;
    if (base === '') return fullKey;
    if (fullKey === base) return '';
    return fullKey.startsWith(`${base}/`) ? fullKey.slice(base.length + 1) : fullKey;
  }

  private stripExtension(key: string): string {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
  }

  private resolveExtension(key: string, metadata: StorageObject['metadata'] | undefined): string {
    const requested = this.determineExtension(key, {
      metadata,
      defaultExtension: this.defaultFileExtension,
    });
    if (requested && this.serializerRegistry[requested]) return requested;
    return this.defaultFileExtension;
  }

  private async serialize(extension: string, content: StorageObjectContent): Promise<string> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    return serializer.serializeDocumentFileContents(content, {});
  }

  private async deserialize(extension: string, raw: string): Promise<StorageObjectContent> {
    const ext = extension.startsWith('.') ? extension.slice(1) : extension;
    const serializer = this.serializerRegistry[ext];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${this.availableExtensions.join(', ')}`,
      );
    }
    return serializer.deserializeDocumentFileContents(raw, {});
  }

  // ─────────────── extension-free key resolution ───────────────

  /**
   * Find the live `pathname` (with extension) and its blob URL for an
   * extension-free key. Single `list({prefix: key.})` call — Vercel returns
   * the URL inline, so no second HEAD is needed.
   */
  private async resolveKey(
    key: string,
  ): Promise<{ pathname: string; extension: string; url: string } | null> {
    const base = this.stripExtension(stripSlashes(key));
    const fullPrefix = this.fullPath(base) + '.';
    const result = await this.dataSource.list({ prefix: fullPrefix });
    if (Result.isFailure(result)) {
      // List failure is observable in resolveKey only as "not found"; the
      // explicit error path goes through `getObject` which re-runs list.
      return null;
    }
    for (const entry of result.success.blobs) {
      const tail = entry.pathname.slice(fullPrefix.length);
      if (tail.includes('/')) continue; // entry is in a subfolder, not the key itself
      if (this.availableExtensions.includes(tail)) {
        return { pathname: entry.pathname, extension: tail, url: entry.url };
      }
    }
    return null;
  }

  /** Direct existence probe — for `isFile`. */
  private async hasKey(key: string): Promise<boolean> {
    return (await this.resolveKey(key)) !== null;
  }

  /** Directory probe: any entry under `prefix/`. */
  private async hasDirectory(key: string): Promise<boolean> {
    const fullPrefix = this.fullPath(key);
    const search = fullPrefix === '' ? '' : `${fullPrefix}/`;
    const result = await this.dataSource.list({ prefix: search, limit: 1 });
    if (Result.isFailure(result)) return false;
    return result.success.blobs.length > 0;
  }

  // ─────────────────────── contract methods ───────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveKey(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`Vercel Blob object not found: ${key}`));
        }
        const body = yield* liftResult(this.dataSource.fetchByUrl(resolved.url));
        if (!body) {
          return yield* Effect.fail(new NotFoundError(`Vercel Blob URL gone: ${key}`));
        }
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, body.body));
        const now = new Date();
        const callerKey = this.stripExtension(this.relativePath(resolved.pathname));
        return {
          type: 'object',
          key: callerKey,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          content,
          metadata: { extension: resolved.extension, revisionId: resolved.url },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const exists = yield* Effect.promise(() => this.hasDirectory(key));
        if (!exists) {
          return yield* Effect.fail(new NotFoundError(`Vercel Blob folder not found: ${key || '<root>'}`));
        }
        const now = new Date().toISOString();
        return {
          type: 'folder',
          key,
          createdAt: now,
          updatedAt: now,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const isFile = yield* Effect.promise(() => this.hasKey(key));
        if (isFile) return yield* LaikaTask.runValue(this.getObject(key));
        const isDir = yield* Effect.promise(() => this.hasDirectory(key));
        if (isDir) return yield* LaikaTask.runValue(this.getFolder(key));
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const existing = yield* Effect.promise(() => this.resolveKey(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const path = `${this.fullPath(this.stripExtension(create.key))}.${extension}`;
        yield* liftResult(
          this.dataSource.put(path, serialized, { contentType: contentTypeFor(extension) }),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveKey(update.key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`Vercel Blob object not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() =>
            this.serialize(resolved.extension, update.content!)
          );
          yield* liftResult(
            this.dataSource.put(resolved.pathname, serialized, {
              contentType: contentTypeFor(resolved.extension),
            }),
          );
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveKey(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const path = existing
          ? existing.pathname
          : `${this.fullPath(this.stripExtension(create.key))}.${extension}`;
        yield* liftResult(
          this.dataSource.put(path, serialized, { contentType: contentTypeFor(extension) }),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // Vercel Blob is path-flat; an empty folder is implied by a `.keep` placeholder.
        const path = this.fullPath(pathCombine(folderCreate.key, '.keep'));
        yield* liftResult(this.dataSource.put(path, '', { contentType: 'text/plain' }));
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        // Resolve every key to its URL in parallel, partitioning into found / not-found.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string; resolved: { url: string; key: string } | null }> = [];
          for (const k of keys) {
            const r = await this.resolveKey(k);
            out.push({
              key: k,
              resolved: r ? { url: r.url, key: this.stripExtension(this.relativePath(r.pathname)) } : null,
            });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<
          { key: string; resolved: { url: string; key: string } }
        >;
        const missing = resolved.filter(r => r.resolved === null);

        // Single POST /delete with every URL — one round-trip regardless of N.
        if (found.length > 0) {
          yield* liftResult(this.dataSource.deleteByUrls(found.map(r => r.resolved.url)));
        }

        for (const f of found) yield* emit.data(f.resolved.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`Vercel Blob object not found: ${m.key}`));
        }

        return { removed: found.length, skipped: missing.length };
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const summaries = yield* this.collectFilteredSummaries(folderKey, options);
        for (const summary of summaries) {
          if (summary.type === 'object-summary') {
            const result = yield* Effect.result(LaikaTask.runValue(this.getObject(summary.key)));
            if (Result.isFailure(result)) yield* emit.recoverableError(result.failure);
            else yield* emit.data(result.success);
          } else {
            const result = yield* Effect.result(LaikaTask.runValue(this.getFolder(summary.key)));
            if (Result.isFailure(result)) yield* emit.recoverableError(result.failure);
            else yield* emit.data(result.success);
          }
        }
        return { total: summaries.length };
      })
    );
  }

  /**
   * Vercel Blob has no `delimiter` query param, so subfolder grouping is
   * reconstructed here: list every entry under `folderKey/`, then partition
   * the relative tail by whether it contains another `/` (→ folder) or not
   * (→ file).
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const fullPrefix = this.fullPath(folderKey);
      const search = fullPrefix === '' ? '' : `${fullPrefix}/`;

      const allEntries: VercelBlobListEntry[] = [];
      let cursor: string | undefined;
      do {
        const page = yield* liftResult(this.dataSource.list({ prefix: search, cursor, limit: 1000 }));
        allEntries.push(...page.blobs);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);

      const seenFiles = new Set<string>();
      const seenFolders = new Set<string>();

      for (const entry of allEntries) {
        const tail = entry.pathname.startsWith(search) ? entry.pathname.slice(search.length) : entry.pathname;
        if (tail === '') continue;
        const slash = tail.indexOf('/');
        if (slash === -1) {
          // Direct file at this level — strip any registered extension.
          let key = tail;
          for (const ext of this.availableExtensions) {
            if (key.endsWith(`.${ext}`)) { key = key.slice(0, -(ext.length + 1)); break; }
          }
          seenFiles.add(key);
        } else {
          seenFolders.add(tail.slice(0, slash));
        }
      }

      const callerPrefix = folderKey === '' ? '' : `${folderKey}/`;
      const files: AtomSummary[] = [...seenFiles].map(k => ({
        type: 'object-summary',
        key: callerPrefix + k,
      }));
      const folders: AtomSummary[] = [...seenFolders].map(k => ({
        type: 'folder-summary',
        key: callerPrefix + k,
      }));

      const merged = [...files, ...folders]
        .filter(s => this.excludeFilter.every(pattern => !pattern.test(s.key)));
      const sorted = [...merged].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a Vercel Blob pathname using any registered serializer extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over Vercel Blob list pages; native cursor pagination is not surfaced.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

/** Best-effort Content-Type for the small set of text serializer formats. */
const contentTypeFor = (extension: string): string => {
  const map: Record<string, string> = {
    json: 'application/json',
    md: 'text/markdown',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    txt: 'text/plain',
    html: 'text/html',
    xml: 'application/xml',
  };
  return map[extension] ?? 'application/octet-stream';
};

// Cap unused imports — InternalError lives here in case future extensions
// surface non-NotFound failures from resolveKey.
void InternalError;
