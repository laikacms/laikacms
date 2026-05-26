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
  FirestoreDataSource,
  type FirestoreDataSourceOptions,
  type FirestoreDocument,
  fromFirestoreFields,
  toFirestoreFields,
  validateSegments,
} from './firestore-datasource.js';

export interface FirestoreStorageRepositoryOptions extends FirestoreDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const TYPE_FIELD = '_type';
const EXTENSION_FIELD = '_extension';
const CONTENT_FIELD = '_content';

/**
 * Strip the standard Firestore resource prefix off a document name to get
 * just the path under `documents/` — used when surfacing keys back to callers.
 */
const pathFromDocumentName = (name: string): string => {
  const marker = '/documents/';
  const idx = name.indexOf(marker);
  return idx === -1 ? name : name.slice(idx + marker.length);
};

/**
 * A {@link StorageRepository} backed by Firebase Firestore via its REST API.
 *
 * Mapping decision: every path segment becomes a Firestore document, every
 * folder owns an `items` subcollection holding its direct children. For a
 * storage key `a/b/c` under the default root, the wire path is
 * `laika/a/items/b/items/c`. **Listing a folder is one native subcollection
 * GET** — no prefix scans, no client-side filtering.
 *
 * Each document stores:
 *
 *     _type       'file' | 'folder'
 *     _extension  on-server file extension                 (files only)
 *     _content    serialized object content (string)       (files only)
 *
 * Firestore values are typed on the wire; the data source's
 * `toFirestoreValue` / `fromFirestoreValue` helpers handle the wrapping.
 *
 * Path segments must match `^[A-Za-z0-9._-]+$` so they're safe as Firestore
 * document IDs. Anything outside that surface area is rejected upfront with
 * `BadRequestError`.
 *
 * Runtime-agnostic — only depends on `fetch`. Caller owns OAuth2 refresh via
 * the optional `tokenProvider` callback.
 */
export class FirestoreStorageRepository extends StorageRepository {
  private readonly dataSource: FirestoreDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: FirestoreStorageRepositoryOptions) {
    super();
    this.dataSource = new FirestoreDataSource(options);
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

  /**
   * Probe each registered extension in parallel — one Firestore GET per
   * extension, all in flight at once. Returns the first existing file's
   * document + extension.
   */
  private async findExistingFile(
    key: string,
  ): Promise<LaikaResult<{ doc: FirestoreDocument, extension: string } | null>> {
    const baseSegmentsResult = validateSegments(key);
    if (Result.isFailure(baseSegmentsResult)) return Result.fail(baseSegmentsResult.failure);
    const baseSegments = baseSegmentsResult.success;
    if (baseSegments.length === 0) return Result.succeed(null);

    const parentSegments = baseSegments.slice(0, -1);
    const baseName = baseSegments[baseSegments.length - 1];
    const probes = await Promise.all(
      this.availableExtensions.map(ext => this.dataSource.getDocument([...parentSegments, `${baseName}.${ext}`])),
    );
    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i];
      if (Result.isFailure(probe)) return Result.fail(probe.failure);
      const doc = probe.success;
      if (!doc?.fields) continue;
      const fields = fromFirestoreFields(doc.fields);
      if (fields[TYPE_FIELD] === 'file') {
        return Result.succeed({ doc, extension: this.availableExtensions[i] });
      }
    }
    return Result.succeed(null);
  }

  /** Pull the path-relative key off a Firestore document name. */
  private childKey(parent: string, doc: FirestoreDocument): string {
    const path = pathFromDocumentName(doc.name);
    const segments = path.split('/');
    const childSegment = segments[segments.length - 1];
    return parent === '' ? childSegment : `${parent}/${childSegment}`;
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const found = yield* liftResult(this.findExistingFile(key));
        if (!found) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const fields = fromFirestoreFields(found.doc.fields ?? {});
        const content = yield* Effect.promise(() =>
          this.deserialize(found.extension, String(fields[CONTENT_FIELD] ?? ''))
        );
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: found.doc.createTime,
          updatedAt: found.doc.updateTime,
          content,
          metadata: { extension: found.extension, revisionId: found.doc.updateTime },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const segmentsResult = validateSegments(key);
        if (Result.isFailure(segmentsResult)) return yield* Effect.fail(segmentsResult.failure);
        const segments = segmentsResult.success;
        if (segments.length === 0) {
          return { type: 'folder', key: '' } satisfies Folder;
        }
        const doc = yield* liftResult(this.dataSource.getDocument(segments));
        if (!doc) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        const fields = fromFirestoreFields(doc.fields ?? {});
        if (fields[TYPE_FIELD] !== 'folder') {
          return yield* Effect.fail(new NotFoundError(`Key "${key}" is not a folder`));
        }
        return {
          type: 'folder',
          key: trimSlashes(key),
          createdAt: doc.createTime,
          updatedAt: doc.updateTime,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const segmentsResult = validateSegments(key);
        if (Result.isFailure(segmentsResult)) return yield* Effect.fail(segmentsResult.failure);
        const segments = segmentsResult.success;
        if (segments.length === 0) {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        const doc = yield* liftResult(this.dataSource.getDocument(segments));
        const fields = doc ? fromFirestoreFields(doc.fields ?? {}) : {};
        if (fields[TYPE_FIELD] === 'folder') {
          return yield* LaikaTask.runValue(this.getFolder(key)) as Effect.Effect<Atom, LaikaError>;
        }
        return yield* LaikaTask.runValue(this.getObject(key)) as Effect.Effect<Atom, LaikaError>;
      })
    );
  }

  /** Idempotently write a folder marker document for every ancestor of `folderKey`. */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const segmentsResult = validateSegments(folderKey);
    if (Result.isFailure(segmentsResult)) return Result.fail(segmentsResult.failure);
    const segments = segmentsResult.success;
    for (let i = 0; i < segments.length; i++) {
      const prefix = segments.slice(0, i + 1);
      const existing = await this.dataSource.getDocument(prefix);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      const fields = existing.success ? fromFirestoreFields(existing.success.fields ?? {}) : {};
      if (fields[TYPE_FIELD] === 'folder') continue;
      const put = await this.dataSource.putDocument(prefix, toFirestoreFields({ [TYPE_FIELD]: 'folder' }));
      if (Result.isFailure(put)) return Result.fail(put.failure);
    }
    return Result.succeed(undefined);
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new InvalidData('Object content is required for creation'));
        }
        const segmentsResult = validateSegments(create.key);
        if (Result.isFailure(segmentsResult)) return yield* Effect.fail(segmentsResult.failure);
        const segments = segmentsResult.success;
        if (segments.length === 0) {
          return yield* Effect.fail(new BadRequestError('Cannot create the root as an object'));
        }
        const existing = yield* liftResult(this.findExistingFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));

        const parentSegments = segments.slice(0, -1);
        if (parentSegments.length > 0) {
          yield* liftResult(this.ensureFolderChain(parentSegments.join('/')));
        }

        const baseName = segments[segments.length - 1];
        const fullSegments = [...parentSegments, `${baseName}.${extension}`];
        yield* liftResult(this.dataSource.putDocument(
          fullSegments,
          toFirestoreFields({
            [TYPE_FIELD]: 'file',
            [EXTENSION_FIELD]: extension,
            [CONTENT_FIELD]: serialized,
          }),
        ));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const found = yield* liftResult(this.findExistingFile(update.key));
        if (!found) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(found.extension, update.content!));
          // Reuse the doc's existing segments — we know its path from `doc.name`.
          const path = pathFromDocumentName(found.doc.name);
          const segments = this.segmentsFromWirePath(path);
          yield* liftResult(this.dataSource.putDocument(
            segments,
            toFirestoreFields({
              [TYPE_FIELD]: 'file',
              [EXTENSION_FIELD]: found.extension,
              [CONTENT_FIELD]: serialized,
            }),
          ));
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

  /**
   * Reverse `documentPath` — take a wire path like `laika/a/items/b/items/c.md`
   * and recover the segments `[a, b, c.md]`. The items-collection name is
   * dynamic, so we ask the data source for it.
   */
  private segmentsFromWirePath(path: string): string[] {
    const parts = path.split('/');
    // parts = [rootCollection, seg, items, seg, items, seg, ...]
    const out: string[] = [];
    for (let i = 1; i < parts.length; i += 2) out.push(parts[i]);
    return out;
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
          const segmentsResult = validateSegments(key);
          if (Result.isFailure(segmentsResult)) {
            yield* emit.recoverableError(segmentsResult.failure);
            skipped += 1;
            continue;
          }
          const segments = segmentsResult.success;
          if (segments.length === 0) {
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the storage root'));
            skipped += 1;
            continue;
          }

          // Folder?
          const direct = yield* Effect.result(liftResult(this.dataSource.getDocument(segments)));
          if (Result.isFailure(direct)) {
            yield* emit.recoverableError(direct.failure);
            skipped += 1;
            continue;
          }
          const fields = direct.success ? fromFirestoreFields(direct.success.fields ?? {}) : null;
          if (fields && fields[TYPE_FIELD] === 'folder') {
            const children = yield* Effect.result(liftResult(this.dataSource.listCollection(segments)));
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
            const deleted = yield* Effect.result(liftResult(this.dataSource.deleteDocument(segments)));
            if (Result.isFailure(deleted)) {
              yield* emit.recoverableError(deleted.failure);
              skipped += 1;
            } else {
              yield* emit.data(trimSlashes(key));
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
          const path = pathFromDocumentName(file.success.doc.name);
          const wireSegments = this.segmentsFromWirePath(path);
          const deleted = yield* Effect.result(liftResult(this.dataSource.deleteDocument(wireSegments)));
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
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const segmentsResult = validateSegments(folderKey);
      if (Result.isFailure(segmentsResult)) return yield* Effect.fail(segmentsResult.failure);
      const segments = segmentsResult.success;

      if (segments.length > 0) {
        const folderDoc = yield* liftResult(this.dataSource.getDocument(segments));
        const fields = folderDoc ? fromFirestoreFields(folderDoc.fields ?? {}) : null;
        if (!fields || fields[TYPE_FIELD] !== 'folder') {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      const children = yield* liftResult(this.dataSource.listCollection(segments));
      const parentKey = trimSlashes(folderKey);
      const summaries: AtomSummary[] = children.map((doc): AtomSummary => {
        const childKey = this.childKey(parentKey, doc);
        const fields = fromFirestoreFields(doc.fields ?? {});
        if (fields[TYPE_FIELD] === 'folder') {
          return { type: 'folder-summary', key: childKey };
        }
        // Strip the extension from the file's last segment so callers see the
        // extension-free key they wrote.
        const ext = String(fields[EXTENSION_FIELD] ?? '');
        const bareKey = ext && childKey.endsWith(`.${ext}`)
          ? childKey.slice(0, -(ext.length + 1))
          : childKey;
        return { type: 'object-summary', key: bareKey };
      });
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description: 'Stores each object as a Firestore document — the on-server document id is `<basename>.<ext>`.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over a native Firestore subcollection `GET`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
