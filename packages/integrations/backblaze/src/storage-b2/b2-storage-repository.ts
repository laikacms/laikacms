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

import type { B2DataSource, B2FileVersion } from './b2-datasource.js';

export interface B2StorageRepositoryOptions {
  readonly dataSource: B2DataSource;
  /** Optional path prefix scoping every operation under a subfolder. */
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
 * A {@link StorageRepository} backed by Backblaze B2 via the native API.
 *
 * Five wire-format traits distinguish this backend:
 *
 *  - **Two-phase upload**: every `createObject` / `updateObject` first
 *    acquires an upload URL (`b2_get_upload_url`), then uploads to *that*
 *    URL with a per-upload auth token. Different endpoint, different
 *    token, different lifecycle.
 *
 *  - **File versioning**: every upload creates a new file version. The
 *    repository's read path uses the latest version (the most recent
 *    upload for that file name); the delete path needs the
 *    `(fileName, fileId)` tuple. To delete by path alone, we first
 *    list versions and then delete each.
 *
 *  - **Mandatory SHA-1 verification**: every upload includes a
 *    `X-Bz-Content-Sha1` header. B2 rejects mismatches at the storage
 *    layer. The data source computes the hash via Web Crypto before
 *    each PUT.
 *
 *  - **Bare `Authorization: <token>`** header — no `Bearer`, no
 *    `Token`. Pay attention if you're routing through a reverse proxy
 *    that "normalises" auth headers.
 *
 *  - **POST-for-everything** — even list and delete operations use
 *    POST with a JSON body.
 *
 * Empty folders use `.keep` placeholders (S3/R2/Vercel Blob convention).
 * `removeAtoms(N)` does N parallel `b2_delete_file_version` calls — B2
 * has no bulk-delete endpoint. **Not a new atomic-multi-write
 * mechanism**, same honest framing as Solid Pod, ClickHouse, Trello,
 * Convex, InfluxDB.
 */
export class B2StorageRepository extends StorageRepository {
  private readonly dataSource: B2DataSource;
  private readonly basePath: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: B2StorageRepositoryOptions) {
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

  // ───────────────────────── path plumbing ─────────────────────────

  private absolutePath(key: string): string {
    const k = stripSlashes(key);
    if (this.basePath === '') return k;
    if (k === '') return this.basePath;
    return `${this.basePath}/${k}`;
  }

  private relativisePath(fileName: string): string {
    if (this.basePath === '') return fileName;
    if (fileName === this.basePath) return '';
    return fileName.startsWith(`${this.basePath}/`) ? fileName.slice(this.basePath.length + 1) : fileName;
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
   * Resolve an extension-free key to its latest B2 file version. Walks
   * the registered extensions via `b2_list_file_names` with `prefix =
   * <key>.` — one list call gives us every matching version across
   * extensions.
   */
  private async resolveFile(key: string): Promise<{ file: B2FileVersion, extension: string } | null> {
    const base = this.stripExtension(stripSlashes(key));
    const absoluteBase = this.absolutePath(base);
    const result = await this.dataSource.listFileNames({
      prefix: `${absoluteBase}.`,
      maxFileCount: 100,
    });
    if (Result.isFailure(result)) return null;
    for (const file of result.success.files) {
      const tail = file.fileName.slice(absoluteBase.length + 1);
      if (tail.includes('/')) continue; // subfolder file, not the key
      if (this.availableExtensions.includes(tail)) {
        return { file, extension: tail };
      }
    }
    return null;
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`Backblaze B2 file not found: ${key}`));
        }
        const text = yield* liftResult(this.dataSource.downloadFile(resolved.file.fileName));
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, text));
        const isoTime = new Date(resolved.file.uploadTimestamp).toISOString();
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: isoTime,
          updatedAt: isoTime,
          content,
          // B2's fileId is the canonical version identifier — it changes
          // on every upload. First backend where revisionId is the
          // platform's intrinsic version id.
          metadata: { extension: resolved.extension, revisionId: resolved.file.fileId },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        const prefix = this.absolutePath(k);
        const search = prefix === '' ? '' : `${prefix}/`;
        const result = yield* liftResult(this.dataSource.listFileNames({
          prefix: search,
          maxFileCount: 1,
        }));
        if (result.files.length === 0) {
          return yield* Effect.fail(new NotFoundError(`Backblaze B2 folder not found: ${k || '<root>'}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
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
        const fileName = this.absolutePath(fullKey);
        yield* liftResult(this.dataSource.uploadFile(
          fileName,
          serialized,
          contentTypeFor(extension),
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
          return yield* Effect.fail(new NotFoundError(`Backblaze B2 file not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          // Versioning semantics: new upload creates a new version; older
          // versions remain until explicitly deleted. Listing returns the
          // latest version per fileName, so reads see the new content.
          yield* liftResult(this.dataSource.uploadFile(
            existing.file.fileName,
            serialized,
            contentTypeFor(existing.extension),
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
        const fileName = existing?.file.fileName ?? this.absolutePath(fullKey);
        yield* liftResult(this.dataSource.uploadFile(
          fileName,
          serialized,
          contentTypeFor(extension),
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // B2 has no native folder concept — drop a `.keep` placeholder.
        const placeholderKey = pathCombine(folderCreate.key, '.keep');
        const fileName = this.absolutePath(placeholderKey);
        yield* liftResult(this.dataSource.uploadFile(fileName, '', 'text/plain'));
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  /**
   * N parallel `b2_delete_file_version` calls — Backblaze B2 has no
   * bulk-delete endpoint. Each delete requires resolving the file's
   * `fileId` first (via the resolveFile probe).
   *
   * **Not a new atomic-multi-write mechanism** — honest framing.
   */
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

        const results = yield* Effect.promise(async () => {
          return await Promise.all(cleanKeys.map(async k => {
            const resolved = await this.resolveFile(k);
            if (!resolved) return { key: k, outcome: 'missing' as const };
            const del = await this.dataSource.deleteFileVersion(
              resolved.file.fileName,
              resolved.file.fileId,
            );
            return Result.isSuccess(del)
              ? { key: k, outcome: 'removed' as const }
              : { key: k, outcome: 'failed' as const, error: del.failure };
          }));
        });

        let removed = 0;
        let skipped = skipped0;
        for (const r of results) {
          if (r.outcome === 'removed') {
            yield* emit.data(r.key);
            removed += 1;
          } else if (r.outcome === 'missing') {
            yield* emit.recoverableError(new NotFoundError(`Backblaze B2 file not found: ${r.key}`));
            skipped += 1;
          } else {
            yield* emit.recoverableError(r.error);
            skipped += 1;
          }
        }
        return { removed, skipped };
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
   * Single `b2_list_file_names` with `delimiter='/'` for server-side
   * subfolder grouping. B2 returns entries whose names end with `/` as
   * folders (in the `nextFileName` cursor convention).
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const k = stripSlashes(folderKey);
      const prefix = this.absolutePath(k);
      const search = prefix === '' ? '' : `${prefix}/`;

      const result = yield* liftResult(this.dataSource.listFileNames({
        prefix: search,
        delimiter: '/',
        maxFileCount: 1000,
      }));

      const seenFiles = new Set<string>();
      const seenFolders = new Set<string>();

      for (const file of result.files) {
        // B2 with `delimiter='/'` treats entries ending in `/` as
        // synthesized subfolder markers. Real files don't end in `/`.
        if (file.fileName.endsWith('/')) {
          const relative = this.relativisePath(file.fileName);
          const folderName = relative.slice(search === '' ? 0 : k.length + 1).replace(/\/+$/, '');
          if (folderName !== '') seenFolders.add(folderName);
          continue;
        }
        const relative = this.relativisePath(file.fileName);
        const tail = relative.startsWith(search === '' ? '' : `${k}/`)
          ? relative.slice(search === '' ? 0 : k.length + 1)
          : relative;
        if (tail === '' || tail.includes('/')) continue;
        let name = tail;
        for (const ext of this.availableExtensions) {
          if (name.endsWith(`.${ext}`)) {
            name = name.slice(0, -(ext.length + 1));
            break;
          }
        }
        seenFiles.add(name);
      }

      const callerPrefix = k === '' ? '' : `${k}/`;
      const summaries: AtomSummary[] = [
        ...[...seenFiles].map(name => ({ type: 'object-summary' as const, key: callerPrefix + name })),
        ...[...seenFolders].map(name => ({ type: 'folder-summary' as const, key: callerPrefix + name })),
      ];
      const filtered = summaries.filter(s => this.excludeFilter.every(p => !p.test(s.key)));
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description:
          'Each object is one B2 file; the extension is preserved in the file name. File versions accumulate per fileName.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description:
          'In-memory slicing over B2 list responses; native `nextFileName` cursor pagination not yet pushed down.',
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
