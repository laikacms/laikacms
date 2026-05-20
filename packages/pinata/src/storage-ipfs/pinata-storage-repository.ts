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
  PinataDataSource,
  type PinataDataSourceOptions,
  type PinataKeyValues,
  type PinataPinRow,
} from './pinata-datasource.js';

export interface PinataStorageRepositoryOptions extends PinataDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string; name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/**
 * A {@link StorageRepository} backed by IPFS via [Pinata](https://www.pinata.cloud).
 * The first **content-addressed** storage backend in the suite — every other
 * backend is path-addressed (S3, R2, Azure, Dropbox, WebDAV, …), id-addressed
 * (Drive, Firestore, Notion), or filter-indexed (Algolia, DDB, D1,
 * PocketBase). IPFS uses cryptographic content hashes (CIDs) — the CID of
 * a file *is* its content, so writes never mutate; they pin new content
 * with a new CID.
 *
 * The mutable storage contract gets layered on top via Pinata's pin metadata:
 *
 * - `metadata.name` is set to the storage path. Searchable via
 *   `metadata[name]={value:'…',op:'eq'}` on `/data/pinList`.
 * - `metadata.keyvalues.type` discriminates `'file' | 'folder'`.
 * - `metadata.keyvalues.parent` indexes the parent path for cheap folder
 *   listings.
 * - `metadata.keyvalues.extension` carries the on-server extension for
 *   files.
 *
 * **Update is copy-on-write**: pin new content → search for old pins
 * with the same `metadata.name` → unpin them. There's a brief window
 * where both the old and new pin exist; readers always pick the
 * most-recently-pinned row by `date_pinned`.
 *
 * Trade-offs (laid out in the README):
 *
 * - **Eventual consistency on metadata search.** Pinata's pinList index
 *   updates within seconds but not synchronously with the pin call. If
 *   you read immediately after writing, you may see the old CID. The
 *   repository doesn't paper over this; deployments that need
 *   read-your-writes consistency should add a local cache.
 * - **Garbage-collection is on you.** Unpinning is best-effort; old
 *   pins remain on IPFS until garbage-collected. Pinata's billing meters
 *   the *pinned* size, not the historical size — so unpinning eventually
 *   stops paying for it, but the data may still be retrievable through
 *   gateways for a while.
 * - **No OCC.** No version counter; concurrent writers race.
 *
 * Runtime-agnostic — only depends on `fetch`.
 */
export class PinataStorageRepository extends StorageRepository {
  private readonly dataSource: PinataDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: PinataStorageRepositoryOptions) {
    super();
    this.dataSource = new PinataDataSource(options);
    this.serializerRegistry = options.serializerRegistry;
    this.defaultFileExtension = options.defaultFileExtension.startsWith('.')
      ? options.defaultFileExtension.slice(1)
      : options.defaultFileExtension;
    this.availableExtensions = Object.keys(options.serializerRegistry);
    this.determineExtension = options.determineExtension ?? defaultDetermineExtension;
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

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

  /** Pick the most-recently-pinned row when search returns multiples (post-update window). */
  private latestByPinnedAt(rows: PinataPinRow[]): PinataPinRow | null {
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => b.date_pinned.localeCompare(a.date_pinned))[0];
  }

  /**
   * Find an extension-free key with one search per registered extension,
   * fired in parallel against Pinata's pinList. Each search returns 0 or
   * more rows (multiples during the copy-on-write update window — the most
   * recent wins).
   */
  private async findExistingFile(key: string): Promise<LaikaResult<PinataPinRow | null>> {
    const trimmed = trimSlashes(key);
    if (trimmed === '') return Result.succeed(null);
    const probes = await Promise.all(this.availableExtensions.map(ext =>
      this.dataSource.searchPins({ 'metadata[name]': `${trimmed}.${ext}` }),
    ));
    for (const probe of probes) {
      if (Result.isFailure(probe)) return Result.fail(probe.failure);
      const rows = probe.success.filter(r => r.metadata.keyvalues.type === 'file');
      const latest = this.latestByPinnedAt(rows);
      if (latest) return Result.succeed(latest);
    }
    return Result.succeed(null);
  }

  private async findFolder(path: string): Promise<LaikaResult<PinataPinRow | null>> {
    const trimmed = trimSlashes(path);
    if (trimmed === '') return Result.succeed(null);
    const probe = await this.dataSource.searchPins({ 'metadata[name]': trimmed });
    if (Result.isFailure(probe)) return Result.fail(probe.failure);
    const rows = probe.success.filter(r => r.metadata.keyvalues.type === 'folder');
    return Result.succeed(this.latestByPinnedAt(rows));
  }

  /** Idempotently pin a folder marker for every ancestor of `folderKey`. */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const ancestorParent = segments.slice(0, i).join('/');
      const ancestorName = segments[i];
      const ancestorPath = segments.slice(0, i + 1).join('/');
      const existing = await this.findFolder(ancestorPath);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success) continue;
      const pinned = await this.dataSource.pinFile('', {
        name: ancestorPath,
        keyvalues: { type: 'folder', parent: ancestorParent, path: ancestorPath },
      });
      if (Result.isFailure(pinned)) return Result.fail(pinned.failure);
    }
    return Result.succeed(undefined);
  }

  /**
   * Unpin every CID with `metadata.name == path`. Used for both deletion
   * and the cleanup half of copy-on-write update. Failures on individual
   * unpins are non-fatal — the metadata search would surface them again
   * later if anything went wrong.
   */
  private async unpinAllByName(path: string): Promise<LaikaResult<void>> {
    const rows = await this.dataSource.searchPins({ 'metadata[name]': path });
    if (Result.isFailure(rows)) return Result.fail(rows.failure);
    for (const row of rows.success) {
      const out = await this.dataSource.unpin(row.ipfs_pin_hash);
      if (Result.isFailure(out)) return Result.fail(out.failure);
    }
    return Result.succeed(undefined);
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const found = yield* liftResult(this.findExistingFile(key));
        if (!found) return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        const extension = String(found.metadata.keyvalues.extension ?? '');
        const raw = yield* liftResult(this.dataSource.fetchContent(found.ipfs_pin_hash));
        const content = yield* Effect.promise(() => this.deserialize(extension, raw));
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: found.date_pinned,
          updatedAt: found.date_pinned,
          content,
          metadata: { extension, revisionId: found.ipfs_pin_hash },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        const found = yield* liftResult(this.findFolder(trimmed));
        if (!found) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return {
          type: 'folder',
          key: trimmed,
          createdAt: found.date_pinned,
          updatedAt: found.date_pinned,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        const folder = yield* liftResult(this.findFolder(trimmed));
        if (folder) {
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
        const existing = yield* liftResult(this.findExistingFile(create.key));
        if (existing) {
          const ext = existing.metadata.keyvalues.extension;
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${ext}`,
            ),
          );
        }
        const { parent, name } = splitKey(create.key);
        if (name === '') {
          return yield* Effect.fail(new BadRequestError('Cannot create the storage root as an object'));
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        if (parent !== '') yield* liftResult(this.ensureFolderChain(parent));

        const fullName = `${trimSlashes(create.key)}.${extension}`;
        yield* liftResult(this.dataSource.pinFile(serialized, {
          name: fullName,
          keyvalues: { type: 'file', parent, extension, path: trimSlashes(create.key) },
        }));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const extension = String(existing.metadata.keyvalues.extension ?? this.defaultFileExtension);
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          const oldCid = existing.ipfs_pin_hash;

          // 1. Pin new content. The metadata search now has both old and new.
          yield* liftResult(this.dataSource.pinFile(serialized, {
            name: existing.metadata.name,
            keyvalues: {
              type: 'file',
              parent: existing.metadata.keyvalues.parent,
              extension,
              path: trimSlashes(update.key),
            },
          }));

          // 2. Unpin the old CID. Readers between (1) and (2) get whichever
          //    `date_pinned` is most recent — i.e. the new one.
          yield* liftResult(this.dataSource.unpin(oldCid));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* liftResult(this.findExistingFile(create.key));
        if (existing) {
          return yield* LaikaTask.runValue(this.updateObject({ key: create.key, content: create.content }));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.ensureFolderChain(folderCreate.key));
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
          const trimmed = trimSlashes(key);
          if (trimmed === '') {
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the storage root'));
            skipped += 1;
            continue;
          }

          // Folder?
          const folder = yield* Effect.result(liftResult(this.findFolder(trimmed)));
          if (Result.isFailure(folder)) {
            yield* emit.recoverableError(folder.failure);
            skipped += 1;
            continue;
          }
          if (folder.success) {
            const children = yield* Effect.result(liftResult(this.dataSource.searchPins({
              'metadata[keyvalues]': JSON.stringify({ parent: { value: trimmed, op: 'eq' } }),
            })));
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
            const deleted = yield* Effect.result(liftResult(this.unpinAllByName(trimmed)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(trimmed);
              removed += 1;
            }
            continue;
          }

          // Otherwise resolve as a file with extension.
          const file = yield* Effect.result(liftResult(this.findExistingFile(key)));
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
          const deleted = yield* Effect.result(liftResult(this.unpinAllByName(file.success.metadata.name)));
          if (Result.isFailure(deleted)) {
            yield* emit.recoverableError(deleted.failure);
            skipped += 1;
          } else {
            yield* emit.data(trimmed);
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
      const trimmed = trimSlashes(folderKey);

      if (trimmed !== '') {
        const folder = yield* liftResult(this.findFolder(trimmed));
        if (!folder) {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      // `metadata[keyvalues]` accepts a JSON-encoded operator map.
      const children = yield* liftResult(this.dataSource.searchPins({
        'metadata[keyvalues]': JSON.stringify({ parent: { value: trimmed, op: 'eq' } }),
      }));

      // Deduplicate by metadata.name — copy-on-write window can return two
      // rows for the same logical entry. Keep the most-recently-pinned.
      const byName = new Map<string, PinataPinRow>();
      for (const row of children) {
        const existing = byName.get(row.metadata.name);
        if (!existing || row.date_pinned > existing.date_pinned) {
          byName.set(row.metadata.name, row);
        }
      }

      const summaries: AtomSummary[] = [];
      for (const row of byName.values()) {
        const kvs = row.metadata.keyvalues;
        if (kvs.type === 'folder') {
          summaries.push({ type: 'folder-summary', key: String(kvs.path ?? row.metadata.name) });
        } else {
          const path = String(kvs.path ?? row.metadata.name);
          summaries.push({ type: 'object-summary', key: path });
        }
      }
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a pinned IPFS file; `metadata.name` is the path key.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `/data/pinList` results; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
