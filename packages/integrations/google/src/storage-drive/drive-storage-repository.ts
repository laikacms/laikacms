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
  type DriveFile,
  FOLDER_MIME_TYPE,
  GoogleDriveDataSource,
  type GoogleDriveDataSourceOptions,
} from './drive-datasource.js';

export interface GoogleDriveStorageRepositoryOptions extends GoogleDriveDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/** Path utilities — Drive uses ids everywhere, but the storage contract is path-based. */
const splitKey = (key: string): { parent: string, name: string } => {
  const trimmed = key.replace(/^\/+|\/+$/g, '');
  const idx = trimmed.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: trimmed } : { parent: trimmed.slice(0, idx), name: trimmed.slice(idx + 1) };
};

/**
 * A {@link StorageRepository} backed by Google Drive (My Drive root or a
 * specific folder you own). Each storage object becomes one Drive file under
 * a folder tree rooted at `rootFolderId`; each Laika folder maps to a real
 * Drive folder (`mimeType: 'application/vnd.google-apps.folder'`).
 *
 * Trade-offs versus other storage backends:
 *
 * - **Path resolution costs round-trips.** Drive addresses by file id, not
 *   path, so reads and writes walk segments from the root the first time
 *   and cache the result. A repository instance is reasonably long-lived
 *   for this reason — don't recreate it per request.
 * - **Names aren't unique.** Drive permits multiple files with the same
 *   name in the same folder; this repository picks the first hit. If your
 *   editors create duplicates through the Drive UI, deduplicate them once.
 * - **Real folders, no `.keep` placeholders.** Empty folders exist as
 *   first-class Drive folders, so listings on an empty folder return `[]`
 *   without needing a marker file.
 *
 * Runtime-agnostic — only depends on `fetch`. The caller owns the OAuth2
 * flow and passes either a static `accessToken` or an async `tokenProvider`.
 */
export class GoogleDriveStorageRepository extends StorageRepository {
  private readonly dataSource: GoogleDriveDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: GoogleDriveStorageRepositoryOptions) {
    super();
    const {
      serializerRegistry,
      defaultFileExtension,
      determineExtension = defaultDetermineExtension,
      ...dataSourceOptions
    } = options;

    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
    this.dataSource = new GoogleDriveDataSource(dataSourceOptions);
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
   * matching Drive file and resolved extension, or `null` when nothing matches.
   */
  private async resolveFile(
    parentPath: string,
    name: string,
  ): Promise<LaikaResult<{ file: DriveFile, extension: string, parentId: string } | null>> {
    const parentIdResult = await this.dataSource.resolveFolderId(parentPath);
    if (Result.isFailure(parentIdResult)) {
      if (parentIdResult.failure instanceof NotFoundError) return Result.succeed(null);
      return Result.fail(parentIdResult.failure);
    }
    const parentId = parentIdResult.success;
    for (const ext of this.availableExtensions) {
      const child = await this.dataSource.findChild(parentId, `${name}.${ext}`);
      if (Result.isFailure(child)) return Result.fail(child.failure);
      if (child.success && child.success.mimeType !== FOLDER_MIME_TYPE) {
        return Result.succeed({ file: child.success, extension: ext, parentId });
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
        const { parent, name } = splitKey(key);
        const resolved = yield* liftResult(this.resolveFile(parent, name));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const raw = yield* liftResult(this.dataSource.getFileContent(resolved.file.id));
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, raw));
        return {
          type: 'object',
          key,
          createdAt: resolved.file.createdTime,
          updatedAt: resolved.file.modifiedTime,
          content,
          metadata: { extension: resolved.extension, revisionId: resolved.file.version ?? resolved.file.md5Checksum },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.dataSource.resolvePath(key));
        if (!resolved || resolved.mimeType !== FOLDER_MIME_TYPE) {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key,
          createdAt: resolved.createdTime,
          updatedAt: resolved.modifiedTime,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.dataSource.resolvePath(key));
        if (resolved?.mimeType === FOLDER_MIME_TYPE) {
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
        const { parent, name } = splitKey(create.key);
        const existing = yield* liftResult(this.resolveFile(parent, name));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const parentId = yield* liftResult(this.dataSource.ensureFolderChain(parent));
        yield* liftResult(
          this.dataSource.createFile(parentId, `${name}.${extension}`, serialized, this.contentTypeFor(extension)),
        );
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(update.key);
        const existing = yield* liftResult(this.resolveFile(parent, name));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          yield* liftResult(
            this.dataSource.updateFileContent(
              existing.file.id,
              serialized,
              this.contentTypeFor(existing.extension),
            ),
          );
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { parent, name } = splitKey(create.key);
        const existing = yield* liftResult(this.resolveFile(parent, name));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        if (existing) {
          yield* liftResult(
            this.dataSource.updateFileContent(existing.file.id, serialized, this.contentTypeFor(extension)),
          );
        } else {
          const parentId = yield* liftResult(this.dataSource.ensureFolderChain(parent));
          yield* liftResult(
            this.dataSource.createFile(parentId, `${name}.${extension}`, serialized, this.contentTypeFor(extension)),
          );
        }
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
          const direct = yield* Effect.result(liftResult(this.dataSource.resolvePath(key)));
          if (Result.isFailure(direct)) {
            yield* emit.recoverableError(direct.failure);
            skipped += 1;
            continue;
          }

          // If a literal folder or non-extensioned file exists at this exact path:
          if (direct.success?.mimeType === FOLDER_MIME_TYPE) {
            const children = yield* Effect.result(liftResult(this.dataSource.listChildren(direct.success.id)));
            if (Result.isFailure(children)) {
              yield* emit.recoverableError(children.failure);
              skipped += 1;
              continue;
            }
            if (children.success.length > 0) {
              yield* emit.recoverableError(
                new ForbiddenError(`Refusing to delete non-empty folder "${key}"`),
              );
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(this.dataSource.deleteFile(direct.success.id)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(key);
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve as an extension-free file key.
          const { parent, name } = splitKey(key);
          const file = yield* Effect.result(liftResult(this.resolveFile(parent, name)));
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
          const deleted = yield* Effect.result(liftResult(this.dataSource.deleteFile(file.success.file.id)));
          if (Result.isFailure(deleted)) {
            yield* emit.recoverableError(deleted.failure);
            skipped += 1;
          } else {
            yield* emit.data(key);
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
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const folderResult = yield* Effect.result(liftResult(this.dataSource.resolveFolderId(folderKey)));
      if (Result.isFailure(folderResult)) {
        if (folderResult.failure instanceof NotFoundError) {
          return { summaries: [] as ReadonlyArray<AtomSummary>, missingFolder: folderResult.failure };
        }
        return yield* Effect.fail(folderResult.failure);
      }
      const children = yield* liftResult(this.dataSource.listChildren(folderResult.success));
      const summaries: AtomSummary[] = [];
      for (const child of children) {
        const isFolder = child.mimeType === FOLDER_MIME_TYPE;
        if (isFolder) {
          summaries.push({ type: 'folder-summary', key: folderKey ? `${folderKey}/${child.name}` : child.name });
          continue;
        }
        const ext = this.extensionOf(child.name);
        if (!ext) continue; // Skip files we don't have a serializer for.
        const bare = this.stripExtension(child.name);
        summaries.push({
          type: 'object-summary',
          key: folderKey ? `${folderKey}/${bare}` : bare,
        });
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
        description: 'Stores each object as a Google Drive file using any registered serializer extension.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `files.list`; cursor pagination is not exposed to callers.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
