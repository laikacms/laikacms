import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
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

import { encodeDrivePath, type OneDriveDataSource, type OneDriveItem } from './onedrive-datasource.js';

export interface OneDriveStorageRepositoryOptions {
  readonly dataSource: OneDriveDataSource;
  /**
   * Optional path prefix scoping every operation under a subfolder of the
   * drive. Default `''` — operates at the drive root.
   */
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

const splitPath = (key: string): { parent: string, name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/**
 * A {@link StorageRepository} backed by a OneDrive / SharePoint document
 * library via the Microsoft Graph API.
 *
 * Three traits distinguish it from every other backend in the suite:
 *
 *  - **Native path addressing.** Drive items live at REST URLs like
 *    `{drive}/root:/notes/hello.md:` — no separate lookup step needed
 *    to map a key to an opaque object id. Folder hierarchy is the
 *    real, server-side folder structure of the drive.
 *
 *  - **`POST /$batch` as the bulk endpoint.** `removeAtoms(N)` ships as
 *    a single `$batch` request with N `DELETE` sub-requests. Microsoft
 *    Graph executes them in parallel by default — atomic-ish at the
 *    HTTP layer, not transactional, but per-sub-request success/failure
 *    is reported in a `responses[]` array. **The 9th structurally
 *    distinct atomic-multi-write mechanism in the Laika suite.**
 *
 *  - **Pre-signed download URLs in metadata.** Every file metadata
 *    response carries `@microsoft.graph.downloadUrl` — a short-lived
 *    (1h) public URL. The repository fetches content from there, with
 *    no auth header, saving a second authenticated round-trip and
 *    enabling future direct-from-CDN serving.
 *
 * Empty folders are first-class — Microsoft Graph supports them natively
 * (unlike S3/R2/Vercel Blob), so no `.keep` placeholders are needed.
 */
export class OneDriveStorageRepository extends StorageRepository {
  private readonly dataSource: OneDriveDataSource;
  private readonly basePath: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: OneDriveStorageRepositoryOptions) {
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

  // ───────────────────────── path helpers ─────────────────────────

  private absolutePath(key: string): string {
    const k = stripSlashes(key);
    if (this.basePath === '') return k;
    if (k === '') return this.basePath;
    return `${this.basePath}/${k}`;
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

  /**
   * Resolve an extension-free key to its (item, extension) pair by
   * probing each known serializer extension in parallel. Single
   * `$batch` round-trip with one GET per extension — better than N
   * sequential GETs.
   */
  private async resolveFile(key: string): Promise<{ item: OneDriveItem, extension: string } | null> {
    const base = this.stripExtension(stripSlashes(key));
    const requests = this.availableExtensions.slice(0, 20).map((ext, i) => ({
      id: String(i),
      method: 'GET' as const,
      url: `${this.driveRootPathUrl(`${base}.${ext}`)}`,
    }));
    const batchResult = await this.dataSource.batch(requests);
    if (Result.isFailure(batchResult)) return null;
    const responses = batchResult.success;
    for (const r of responses) {
      if (r.status >= 200 && r.status < 300) {
        const ext = this.availableExtensions[Number(r.id)];
        if (ext) return { item: r.body as OneDriveItem, extension: ext };
      }
    }
    return null;
  }

  /** Path fragment used inside a `$batch` sub-request URL. */
  private driveRootPathUrl(relativePath: string): string {
    const absolute = this.absolutePath(relativePath);
    const encoded = encodeDrivePath(absolute);
    return encoded === '' ? `/me/drive/root` : `/me/drive/root:/${encoded}:`;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`OneDrive item not found: ${key}`));
        }
        const downloadUrl = resolved.item['@microsoft.graph.downloadUrl'];
        if (!downloadUrl) {
          return yield* Effect.fail(new NotFoundError(`OneDrive item is missing @microsoft.graph.downloadUrl: ${key}`));
        }
        const text = yield* liftResult(this.dataSource.getContent(downloadUrl));
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, text));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: resolved.item.createdDateTime ?? new Date(0).toISOString(),
          updatedAt: resolved.item.lastModifiedDateTime ?? new Date(0).toISOString(),
          content,
          metadata: { extension: resolved.extension, revisionId: resolved.item.eTag ?? resolved.item.id },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const path = this.absolutePath(key);
        const item = yield* liftResult(this.dataSource.getItem(path));
        if (!item || !item.folder) {
          return yield* Effect.fail(new NotFoundError(`OneDrive folder not found: ${key || '<root>'}`));
        }
        return {
          type: 'folder',
          key: stripSlashes(key),
          createdAt: item.createdDateTime ?? new Date(0).toISOString(),
          updatedAt: item.lastModifiedDateTime ?? new Date(0).toISOString(),
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.resolveFile(key));
        if (file) return yield* LaikaTask.runValue(this.getObject(key));
        const folder = yield* Effect.result(LaikaTask.runValue(this.getFolder(key)));
        if (Result.isSuccess(folder)) return folder.success;
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new BadRequestError('Object content is required for creation'));
        }
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const fullKey = `${this.stripExtension(create.key)}.${extension}`;
        yield* liftResult(this.dataSource.putContent(
          this.absolutePath(fullKey),
          serialized,
          { contentType: contentTypeFor(extension), conflictBehavior: 'fail' },
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`OneDrive item not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          const fullKey = `${this.stripExtension(update.key)}.${existing.extension}`;
          yield* liftResult(this.dataSource.putContent(
            this.absolutePath(fullKey),
            serialized,
            { contentType: contentTypeFor(existing.extension), conflictBehavior: 'replace' },
          ));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const fullKey = `${this.stripExtension(create.key)}.${extension}`;
        yield* liftResult(this.dataSource.putContent(
          this.absolutePath(fullKey),
          serialized,
          { contentType: contentTypeFor(extension), conflictBehavior: 'replace' },
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        const { parent, name } = splitPath(k);
        const parentAbs = this.absolutePath(parent);
        const result = yield* Effect.result(
          liftResult(this.dataSource.createFolder(parentAbs, name)),
        );
        if (Result.isFailure(result)) {
          // The 'already exists' error is fine — folder creation is idempotent
          // from Laika's perspective.
          if (!(result.failure instanceof EntryAlreadyExistsError)) {
            return yield* Effect.fail(result.failure);
          }
        }
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const cleanKeys = keys.map(s => stripSlashes(s)).filter(s => s !== '');
        const skipped0 = keys.length - cleanKeys.length;
        if (cleanKeys.length === 0) {
          for (let i = 0; i < skipped0; i++) {
            yield* emit.recoverableError(new BadRequestError('Refusing to delete empty key'));
          }
          return { removed: 0, skipped: skipped0 };
        }

        // ── Round-trip 1: resolve every key to its (item, extension).
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string, resolved: { item: OneDriveItem, extension: string } | null }> = [];
          for (const k of cleanKeys) {
            const r = await this.resolveFile(k);
            out.push({ key: k, resolved: r });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<
          { key: string, resolved: { item: OneDriveItem, extension: string } }
        >;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE $batch with N DELETE sub-requests.
        // *The* distinctive trait — N HTTP semantics in one round-trip,
        // each with its own status/body in the responses[] array.
        let removed = 0;
        if (found.length > 0) {
          // Graph caps $batch at 20; chunk if needed.
          for (let i = 0; i < found.length; i += 20) {
            const chunk = found.slice(i, i + 20);
            const requests = chunk.map((f, j) => ({
              id: String(j),
              method: 'DELETE' as const,
              url: this.driveRootPathUrl(`${this.stripExtension(f.key)}.${f.resolved.extension}`),
            }));
            const batchResult = yield* liftResult(this.dataSource.batch(requests));
            for (let j = 0; j < chunk.length; j += 1) {
              const sub = batchResult.find(r => r.id === String(j));
              const f = chunk[j]!;
              if (sub && (sub.status === 204 || sub.status === 200 || sub.status === 404)) {
                // 404 is treated as success — already gone.
                yield* emit.data(f.key);
                removed += 1;
              } else {
                yield* emit.recoverableError(
                  new BadRequestError(`Graph $batch DELETE failed for ${f.key} (status ${sub?.status ?? '?'})`),
                );
              }
            }
          }
        }

        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`OneDrive item not found: ${m.key}`));
        }
        return { removed, skipped: skipped0 + missing.length + (found.length - removed) };
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

  /** Single `/children` GET — OneDrive's listing is server-side hierarchical. */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const path = this.absolutePath(folderKey);
      const items = yield* liftResult(this.dataSource.listChildren(path));

      const callerPrefix = stripSlashes(folderKey) === '' ? '' : `${stripSlashes(folderKey)}/`;
      const summaries: AtomSummary[] = items.map(item => {
        if (item.folder) {
          return { type: 'folder-summary', key: callerPrefix + item.name };
        }
        // Strip a known serializer extension from the filename.
        let name = item.name;
        for (const ext of this.availableExtensions) {
          if (name.endsWith(`.${ext}`)) {
            name = name.slice(0, -(ext.length + 1));
            break;
          }
        }
        return { type: 'object-summary', key: callerPrefix + name };
      });

      const filtered = summaries.filter(s => this.excludeFilter.every(pattern => !pattern.test(s.key)));
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Each object is one OneDrive file; the extension is preserved as the file extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over Graph /children responses; native cursor pagination not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

/** Best-effort Content-Type for the few text serializer formats. */
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

// Reference unused imports so unused-symbol lints don't trip.
void pathCombine;
