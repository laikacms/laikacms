import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  ForbiddenError,
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
  StorageRepository,
} from 'laikacms/storage';

import {
  DROPBOX_FOLDER_TAG,
  type DropboxDataSourceOptions,
  DropboxDataSource,
  type DropboxEntry,
} from './dropbox-datasource.js';

export interface DropboxStorageRepositoryOptions extends DropboxDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** Split a caller-facing key into its parent folder path and basename. */
const splitKey = (key: string): { parent: string; name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/**
 * A {@link StorageRepository} backed by Dropbox via the HTTP API v2. Each
 * Laika storage object is a Dropbox file; each Laika folder is a Dropbox
 * folder. Paths are POSIX (`/notes/hello.md` on Dropbox's side); the
 * repository scopes operations under a configurable `rootPath` so a single
 * Dropbox account can host multiple Laika stores side by side.
 *
 * Trade-offs versus the other SaaS-cloud backend (Google Drive):
 *
 * - **Path-addressed, not id-addressed.** No path → id walk on every read,
 *   no in-memory cache to invalidate — but two files with the same name in
 *   the same folder is impossible (Dropbox enforces uniqueness), which
 *   removes Drive's "first hit wins" caveat.
 * - **Real folders, no `.keep` placeholders.** Dropbox supports empty
 *   folders natively.
 * - **Two separate hostnames.** Metadata calls hit
 *   `api.dropboxapi.com`; uploads and downloads hit `content.dropboxapi.com`
 *   with the upload metadata in the `Dropbox-API-Arg` header.
 *
 * Runtime-agnostic — only depends on `fetch`. The caller owns the OAuth2
 * flow and passes either a static `accessToken` or an async `tokenProvider`.
 */
export class DropboxStorageRepository extends StorageRepository {
  private readonly dataSource: DropboxDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: DropboxStorageRepositoryOptions) {
    super();
    const {
      serializerRegistry,
      defaultFileExtension,
      determineExtension = defaultDetermineExtension,
      ...dataSourceOptions
    } = options;
    this.dataSource = new DropboxDataSource(dataSourceOptions);
    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
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

  private stripExtension(name: string): string {
    for (const ext of this.availableExtensions) {
      if (name.endsWith(`.${ext}`)) return name.slice(0, -(ext.length + 1));
    }
    return name;
  }

  private extensionOf(name: string): string | undefined {
    for (const ext of this.availableExtensions) {
      if (name.endsWith(`.${ext}`)) return ext;
    }
    return undefined;
  }

  /**
   * Probe each registered extension for an extension-free key. Returns the
   * matching Dropbox entry + resolved extension, or `null` when nothing matches.
   */
  private async resolveFile(
    key: string,
  ): Promise<LaikaResult<{ entry: DropboxEntry; extension: string } | null>> {
    const trimmed = trimSlashes(key);
    for (const extension of this.availableExtensions) {
      const candidate = `${trimmed}.${extension}`;
      const meta = await this.dataSource.getMetadata(candidate);
      if (Result.isFailure(meta)) return Result.fail(meta.failure);
      if (meta.success && meta.success['.tag'] === 'file') {
        return Result.succeed({ entry: meta.success, extension });
      }
    }
    return Result.succeed(null);
  }

  private contentTypeFor(extension: string): string {
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
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const dropboxPath = `${trimSlashes(key)}.${resolved.extension}`;
        const download = yield* liftResult(this.dataSource.downloadFile(dropboxPath));
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, download.content));
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: resolved.entry.client_modified ?? resolved.entry.server_modified,
          updatedAt: resolved.entry.server_modified ?? resolved.entry.client_modified,
          content,
          metadata: { extension: resolved.extension, revisionId: resolved.entry.rev },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.dataSource.getMetadata(key));
        if (!meta || meta['.tag'] !== DROPBOX_FOLDER_TAG) {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key: trimSlashes(key),
          createdAt: meta.client_modified ?? meta.server_modified,
          updatedAt: meta.server_modified ?? meta.client_modified,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.dataSource.getMetadata(key));
        if (meta?.['.tag'] === DROPBOX_FOLDER_TAG) {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const existing = yield* liftResult(this.resolveFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent } = splitKey(create.key);
        if (parent !== '') yield* liftResult(this.dataSource.ensureFolderChain(parent));
        const dropboxPath = `${trimSlashes(create.key)}.${extension}`;
        yield* liftResult(this.dataSource.uploadFile(dropboxPath, serialized, 'add'));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.resolveFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() =>
            this.serialize(existing.extension, update.content!)
          );
          const dropboxPath = `${trimSlashes(update.key)}.${existing.extension}`;
          // If the caller passed back a `revisionId`, use it for optimistic concurrency.
          const mode = update.metadata?.revisionId
            ? ({ update: update.metadata.revisionId } as const)
            : ('overwrite' as const);
          yield* liftResult(this.dataSource.uploadFile(dropboxPath, serialized, mode));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.resolveFile(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        const { parent } = splitKey(create.key);
        if (parent !== '') yield* liftResult(this.dataSource.ensureFolderChain(parent));
        const dropboxPath = `${trimSlashes(create.key)}.${extension}`;
        yield* liftResult(this.dataSource.uploadFile(dropboxPath, serialized, 'overwrite'));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.ensureFolderChain(folderCreate.key));
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const meta = yield* Effect.result(liftResult(this.dataSource.getMetadata(key)));
          if (Result.isFailure(meta)) {
            yield* emit.recoverableError(meta.failure);
            skipped += 1;
            continue;
          }

          if (meta.success?.['.tag'] === DROPBOX_FOLDER_TAG) {
            // Refuse non-empty folder deletes, matching the contract of every other StorageRepository.
            const children = yield* Effect.result(liftResult(this.dataSource.listFolder(key)));
            if (Result.isFailure(children)) {
              yield* emit.recoverableError(children.failure);
              skipped += 1;
              continue;
            }
            if (children.success.length > 0) {
              yield* emit.recoverableError(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(this.dataSource.deletePath(key)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(trimSlashes(key));
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve as an extension-free file key.
          const file = yield* Effect.result(liftResult(this.resolveFile(key)));
          if (Result.isFailure(file)) {
            yield* emit.recoverableError(file.failure);
            skipped += 1;
            continue;
          }
          if (!file.success) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const dropboxPath = `${trimSlashes(key)}.${file.success.extension}`;
          const deleted = yield* Effect.result(liftResult(this.dataSource.deletePath(dropboxPath)));
          if (Result.isFailure(deleted)) {
            yield* emit.recoverableError(deleted.failure);
            skipped += 1;
          } else {
            yield* emit.data(trimSlashes(key));
            removed += 1;
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
        const { summaries, missingFolder } = yield* this.collectSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: summaries.length };
      })
    );
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, missingFolder } = yield* this.collectSummaries(folderKey, options);
        if (missingFolder) yield* emit.recoverableError(missingFolder);
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

  private collectSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<
    { summaries: ReadonlyArray<AtomSummary>; missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const listing = yield* Effect.result(liftResult(this.dataSource.listFolder(folderKey)));
      if (Result.isFailure(listing)) {
        if (listing.failure instanceof NotFoundError) {
          return { summaries: [] as ReadonlyArray<AtomSummary>, missingFolder: listing.failure };
        }
        return yield* Effect.fail(listing.failure);
      }

      const summaries: AtomSummary[] = [];
      const trimmed = trimSlashes(folderKey);
      for (const entry of listing.success) {
        const name = entry.name;
        if (entry['.tag'] === DROPBOX_FOLDER_TAG) {
          summaries.push({
            type: 'folder-summary',
            key: trimmed === '' ? name : `${trimmed}/${name}`,
          });
          continue;
        }
        if (entry['.tag'] === 'file') {
          const ext = this.extensionOf(name);
          if (!ext) continue; // Skip files we don't have a serializer for.
          const bare = this.stripExtension(name);
          summaries.push({
            type: 'object-summary',
            key: trimmed === '' ? bare : `${trimmed}/${bare}`,
          });
        }
      }
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-19'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a Dropbox file using any registered serializer extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `/files/list_folder`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
