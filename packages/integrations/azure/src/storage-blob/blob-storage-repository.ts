import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
  InvalidData,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
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

import { AzureBlobDataSource, type BlobOps } from './blob-datasource.js';

export interface AzureBlobStorageRepositoryOptions {
  /**
   * Blob-container abstraction. In production, build this via
   * `azureContainerOps(new ContainerClient(...))`. In tests, pass a plain
   * object satisfying {@link BlobOps} — no SDK mock required.
   */
  readonly ops: BlobOps;
  /** Optional key prefix — every blob is read/written under `<basePath>/...`. */
  readonly basePath?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

/**
 * A {@link StorageRepository} backed by Azure Blob Storage. Mirrors the
 * shape of `@laikacms/aws/storage-s3` (Azure is the third hyperscaler in
 * the suite alongside AWS and GCP-via-Drive):
 *
 * - Flat container with virtual `/`-delimited folders via the SDK's
 *   `listBlobsByHierarchy` call.
 * - `.keep` placeholder blobs so empty folders surface in listings.
 * - Keys are extension-free at the boundary; the on-blob name is
 *   `<key>.<ext>` where `<ext>` is picked from the registered serializers.
 * - `metadata.revisionId` is the blob's ETag.
 *
 * The repository depends on a small {@link BlobOps} interface fronted by
 * the official Azure SDK via `azureContainerOps()` — so tests construct a
 * plain `BlobOps` stub instead of mocking SDK internals.
 */
export class AzureBlobStorageRepository extends StorageRepository {
  private readonly dataSource: AzureBlobDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: AzureBlobStorageRepositoryOptions) {
    super();
    this.serializerRegistry = options.serializerRegistry;
    this.defaultFileExtension = options.defaultFileExtension.startsWith('.')
      ? options.defaultFileExtension.slice(1)
      : options.defaultFileExtension;
    this.availableExtensions = Object.keys(options.serializerRegistry);
    this.determineExtension = options.determineExtension ?? defaultDetermineExtension;
    this.dataSource = new AzureBlobDataSource({
      ops: options.ops,
      availableExtensions: this.availableExtensions,
      basePath: options.basePath,
    });
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

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const [meta, contents] = yield* Effect.all(
          [
            liftResult(this.dataSource.getObjectMeta(key)),
            liftResult(this.dataSource.getObjectContents(key)),
          ],
          { concurrency: 2 },
        );
        const extension = contents.extension;
        const content = yield* Effect.promise(() => this.deserialize(extension, contents.content));
        return {
          type: 'object',
          key: contents.key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
          content,
          metadata: { extension, revisionId: meta.etag },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.dataSource.getFolderMeta(key));
        return {
          type: 'folder',
          key,
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const isFile = yield* Effect.promise(() => this.dataSource.isFile(key));
        if (isFile) return yield* LaikaTask.runValue(this.getObject(key));
        const isDir = yield* Effect.promise(() => this.dataSource.isDirectory(key));
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
        const existing = yield* Effect.promise(() => this.dataSource.findExistingObjectExtension(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        yield* liftResult(this.dataSource.createOrUpdate(create.key, serialized, extension));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const meta = yield* liftResult(this.dataSource.getObjectMeta(update.key));
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(meta.extension, update.content!));
          yield* liftResult(this.dataSource.createOrUpdate(update.key, serialized, meta.extension));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.dataSource.findExistingObjectExtension(create.key));
        const extension = existing ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        yield* liftResult(this.dataSource.createOrUpdate(create.key, serialized, extension));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        // Blob is flat; empty folders are implied by a `.keep` placeholder.
        yield* liftResult(
          this.dataSource.createOrUpdate(pathCombine(folderCreate.key, '.keep'), '', ''),
        );
        return yield* LaikaTask.runValue(this.getFolder(folderCreate.key));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const collected = yield* Effect.promise(async () => {
          const out: LaikaResult<string>[] = [];
          for await (const r of this.dataSource.deleteObjects(keys)) out.push(r);
          return out;
        });

        let removed = 0;
        let skipped = 0;
        for (const result of collected) {
          if (Result.isFailure(result)) {
            yield* emit.recoverableError(result.failure);
            skipped += 1;
            continue;
          }
          yield* emit.data(result.success);
          removed += 1;
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

  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const entries = yield* liftResult(this.dataSource.listDirectory(folderKey));
      const summaries: AtomSummary[] = entries.map(entry => {
        if (entry.kind === 'prefix') {
          return { type: 'folder-summary', key: entry.name };
        }
        let key = entry.name;
        for (const ext of this.availableExtensions) {
          if (key.endsWith(`.${ext}`)) {
            key = key.slice(0, -(ext.length + 1));
            break;
          }
        }
        return { type: 'object-summary', key };
      });
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as an Azure block blob under `<basePath>/<key>.<ext>`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `listBlobsByHierarchy`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
