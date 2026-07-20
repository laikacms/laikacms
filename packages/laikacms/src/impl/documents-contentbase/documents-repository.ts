import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type { LaikaDone, LaikaError } from 'laikacms/core';
import {
  BadRequestError,
  EntryAlreadyExistsError,
  InvalidData,
  LaikaStream,
  LaikaTask,
  NotFoundError,
} from 'laikacms/core';
import type {
  ListRecordsDone,
  ListRecordsOptions,
  ListRecordSummaries,
  ListRevisionsDone,
  ListRevisionsOptions,
  RecordSummary,
  RevisionSummary,
} from 'laikacms/documents';
import {
  type Document,
  type DocumentCreate,
  type DocumentsCapabilities,
  DocumentsCompatibilityDate,
  DocumentsRepository,
  type DocumentUpdate,
  type Record,
  type Revision,
  type RevisionCreate,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedUpdate,
} from 'laikacms/documents';
import type { StorageObjectContent, StorageRepository } from 'laikacms/storage';
import { basename, pathCombine, pathToSegments } from 'laikacms/storage';

/** Lift a LaikaTask into an Effect, forwarding metadata to the outer emit. */
const runForwarding = <A>(
  task: LaikaTask.LaikaTask<A>,
  emit: LaikaTask.LaikaMetadataEmit,
): Effect.Effect<A, LaikaError> => LaikaTask.runValueForwarding(task, emit);

/**
 * Run a child LaikaStream and collect data into a flat array, forwarding any
 * recoverable errors / progress to the outer task's emit so warnings flow
 * through the delegation boundary.
 */
const collectStreamData = <A, D extends LaikaDone, R>(
  stream: LaikaStream.LaikaStream<A, D, R>,
  emit: LaikaTask.LaikaMetadataEmit,
): Effect.Effect<ReadonlyArray<A>, LaikaError, R> =>
  Effect.map(LaikaStream.runCollectForwarding(stream, emit), r => r.data);

export class ContentBaseDocumentsRepository extends DocumentsRepository {
  constructor(
    private readonly storageRepository: StorageRepository,
    private readonly settingsProvider: ContentBaseSettingsProvider,
  ) {
    super();
  }

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.make<DocumentsCapabilities>(emit =>
      Effect.gen({ self: this }, function*() {
        const caps = yield* LaikaTask.runValueForwarding(this.storageRepository.getCapabilities(), emit);
        return {
          compatibilityDate: DocumentsCompatibilityDate.make('2026-05-11'),
          pagination: caps.pagination,
          versionTracking: {
            supported: false,
            description: 'The underlying storage repository does not expose version tokens.',
          },
          changes: {
            supported: false,
            description: 'The underlying storage repository does not expose a change feed.',
          },
        };
      })
    );
  }

  /**
   * Split a document key into its collection prefix and the remainder.
   */
  private parseKey(key: string): { collection: string, remainder: string } {
    const segments = pathToSegments(key);
    if (segments.length === 0) return { collection: '', remainder: '' };
    const [collection, ...rest] = segments;
    return { collection, remainder: rest.length > 0 ? pathCombine(...rest) : '' };
  }

  private getDocumentPath(
    key: string,
    emit: LaikaTask.LaikaMetadataEmit,
  ): Effect.Effect<string, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const { collection, remainder } = this.parseKey(key);
      if (!collection) {
        return yield* Effect.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
      }
      const settings = yield* runForwarding(
        this.settingsProvider.getDocumentCollectionSettings(collection),
        emit,
      );
      const directory = settings.directory ?? collection;
      return remainder ? pathCombine(directory, remainder) : directory;
    });
  }

  private getUnpublishedPath(
    key: string,
    status: string,
    emit: LaikaTask.LaikaMetadataEmit,
  ): Effect.Effect<string, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const { collection, remainder } = this.parseKey(key);
      if (!collection) {
        return yield* Effect.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
      }
      const settings = yield* runForwarding(
        this.settingsProvider.getDocumentCollectionSettings(collection),
        emit,
      );
      const unpublishedStatuses = settings.unpublishedStatuses || {};
      const statusConfig = unpublishedStatuses[status];
      if (!statusConfig) {
        const available = Object.keys(unpublishedStatuses).join(', ');
        const hint = available
          ? ''
          : ' Configure unpublishedStatuses in your ContentBaseSettingsProvider (see DocumentCollectionSettings.unpublishedStatuses).';
        return yield* Effect.fail(
          new BadRequestError(
            `Unknown unpublished status '${status}' for collection '${collection}'. `
              + `Available statuses: ${available}.${hint}`,
          ),
        );
      }
      const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
      return remainder ? pathCombine(basePath, remainder) : basePath;
    });
  }

  private getRevisionPath(
    key: string,
    emit: LaikaTask.LaikaMetadataEmit,
    revision?: string,
  ): Effect.Effect<string, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const { collection, remainder } = this.parseKey(key);
      if (!collection) {
        return yield* Effect.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
      }
      const settings = yield* runForwarding(
        this.settingsProvider.getDocumentCollectionSettings(collection),
        emit,
      );
      const revisionDirectory = settings.revisionDirectory || `.contentbase/${collection}/revisions`;
      const basePath = remainder ? pathCombine(revisionDirectory, remainder) : revisionDirectory;
      return revision ? pathCombine(basePath, revision) : basePath;
    });
  }

  private extractKeyFromPath(fullPath: string, directory: string, collection: string): string {
    const stripped = fullPath.startsWith(directory) ? fullPath.substring(directory.length) : fullPath;
    const segments = pathToSegments(stripped);
    return segments.length > 0 ? pathCombine(collection, ...segments) : collection;
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getDocumentPath(key, emit);
        const obj = yield* LaikaTask.runValueForwarding(this.storageRepository.getObject(path), emit);
        return {
          ...obj,
          key,
          type: 'published' as const,
          language: obj.content.language ?? 'und',
          status: 'published' as const,
        };
      })
    );
  }

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        if (typeof create.content !== 'object' || create.content === null || Array.isArray(create.content)) {
          return yield* Effect.fail(
            new BadRequestError(
              `createDocument: content must be a plain object; got ${typeof create
                .content}. Serialize the document to a structured object before calling createDocument.`,
            ),
          );
        }
        const path = yield* this.getDocumentPath(create.key, emit);
        const obj = yield* LaikaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: path,
            // language is embedded in content so reads derive it from obj.content.language
            content: { ...create.content, language: create.language },
          }),
          emit,
        ).pipe(
          Effect.mapError(e =>
            e instanceof EntryAlreadyExistsError
              ? new EntryAlreadyExistsError(`Already exists: ${create.key}`)
              : e
          ),
        );
        const now = new Date().toISOString();
        return {
          ...obj,
          key: create.key,
          type: 'published' as const,
          status: 'published' as const,
          language: create.language,
          createdAt: now,
          updatedAt: now,
        };
      })
    );
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getDocumentPath(update.key, emit);
        const existing = yield* LaikaTask.runValueForwarding(this.getDocument(update.key), emit);
        const newLanguage = update.language ?? existing.language;
        const newContent = { ...(update.content ?? existing.content), language: newLanguage };
        yield* LaikaTask.runValueForwarding(
          this.storageRepository.updateObject({
            key: path,
            content: newContent,
          }),
          emit,
        );
        return {
          ...existing,
          content: newContent,
          language: newLanguage,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getDocumentPath(key, emit);
        yield* collectStreamData(this.storageRepository.removeAtoms([path]), emit);
      })
    );
  }

  // ===== UNPUBLISHED =====

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const { collection, remainder } = this.parseKey(key);
        if (!collection) {
          return yield* Effect.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
        }
        const settings = yield* runForwarding(
          this.settingsProvider.getDocumentCollectionSettings(collection),
          emit,
        );
        const unpublishedStatuses = settings.unpublishedStatuses || {};

        for (const [status, statusConfig] of Object.entries(unpublishedStatuses)) {
          const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
          const fullPath = remainder ? pathCombine(basePath, remainder) : basePath;
          const r = yield* Effect.result(
            LaikaTask.runValueForwarding(this.storageRepository.getObject(fullPath), emit),
          );
          if (Result.isSuccess(r)) {
            return {
              ...r.success,
              key,
              type: 'unpublished' as const,
              language: r.success.content.language ?? 'und',
              status,
            };
          }
        }
        return yield* Effect.fail(
          new NotFoundError(`Unpublished document '${key}' not found in collection '${collection}'`),
        );
      })
    );
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        if (typeof create.content !== 'object' || create.content === null || Array.isArray(create.content)) {
          return yield* Effect.fail(
            new BadRequestError(`createUnpublished: content must be a plain object; got ${typeof create.content}.`),
          );
        }
        const path = yield* this.getUnpublishedPath(create.key, create.status, emit);
        const obj = yield* LaikaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: path,
            content: { ...create.content, language: create.language },
          }),
          emit,
        ).pipe(
          Effect.mapError(e =>
            e instanceof EntryAlreadyExistsError
              ? new EntryAlreadyExistsError(`Already exists: ${create.key}`)
              : e
          ),
        );
        const now = new Date().toISOString();
        return {
          ...obj,
          key: create.key,
          type: 'unpublished' as const,
          status: create.status,
          language: create.language,
          createdAt: now,
          updatedAt: now,
        };
      })
    );
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValueForwarding(this.getUnpublished(update.key), emit);

        if (update.status && update.status !== existing.status) {
          return yield* LaikaTask.runValueForwarding(
            this.updateUnpublishedStatus(update.key, update.status, update.content, update.language),
            emit,
          );
        }

        const newLanguage = update.language ?? existing.language;
        const newContent = { ...(update.content || existing.content), language: newLanguage };
        const path = yield* this.getUnpublishedPath(update.key, existing.status, emit);
        yield* LaikaTask.runValueForwarding(
          this.storageRepository.updateObject({
            key: path,
            content: newContent,
          }),
          emit,
        );
        return {
          ...existing,
          content: newContent,
          language: newLanguage,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  /** Move an unpublished document to a different status directory, optionally applying content/language edits. */
  private updateUnpublishedStatus(
    key: string,
    newStatus: string,
    newContent?: StorageObjectContent,
    newLanguage?: string,
  ): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValueForwarding(this.getUnpublished(key), emit);
        const oldPath = yield* this.getUnpublishedPath(key, existing.status, emit);
        const newPath = yield* this.getUnpublishedPath(key, newStatus, emit);

        const language = newLanguage ?? existing.language;
        const content = { ...(newContent ?? existing.content), language };

        yield* LaikaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: newPath,
            content,
          }),
          emit,
        ).pipe(
          Effect.mapError(e =>
            e instanceof EntryAlreadyExistsError
              ? new EntryAlreadyExistsError(`Already exists: ${key}`)
              : e
          ),
        );
        yield* collectStreamData(this.storageRepository.removeAtoms([oldPath]), emit);

        return {
          ...existing,
          content,
          language,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(emit =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValueForwarding(this.getUnpublished(key), emit);
        const path = yield* this.getUnpublishedPath(key, existing.status, emit);
        yield* collectStreamData(this.storageRepository.removeAtoms([path]), emit);
      })
    );
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(emit =>
      Effect.gen({ self: this }, function*() {
        const document = yield* LaikaTask.runValueForwarding(this.getDocument(key), emit);
        const documentPath = yield* this.getDocumentPath(key, emit);
        const unpublishedPath = yield* this.getUnpublishedPath(key, status, emit);

        yield* LaikaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: unpublishedPath,
            content: document.content,
          }),
          emit,
        );
        yield* collectStreamData(this.storageRepository.removeAtoms([documentPath]), emit);

        return {
          key,
          type: 'unpublished' as const,
          status,
          language: document.language,
          content: document.content,
          createdAt: document.createdAt,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  publish(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(emit =>
      Effect.gen({ self: this }, function*() {
        const unpublished = yield* LaikaTask.runValueForwarding(this.getUnpublished(key), emit);
        const unpublishedPath = yield* this.getUnpublishedPath(key, unpublished.status, emit);
        const documentPath = yield* this.getDocumentPath(key, emit);

        yield* LaikaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: documentPath,
            content: unpublished.content,
          }),
          emit,
        );
        yield* collectStreamData(this.storageRepository.removeAtoms([unpublishedPath]), emit);

        return {
          key,
          type: 'published' as const,
          status: 'published' as const,
          language: unpublished.language,
          content: unpublished.content,
          createdAt: unpublished.createdAt,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  // ===== RECORDS (LIST ALL TYPES) =====

  listRecords(options: ListRecordsOptions): LaikaStream.LaikaStream<Record, ListRecordsDone> {
    return this.listRecordsInternal<Record>(options, 'full');
  }

  listRecordSummaries(
    options: ListRecordSummaries,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone> {
    return this.listRecordsInternal<RecordSummary>(options, 'summary');
  }

  private listRecordsInternal<T extends Record | RecordSummary>(
    options: ListRecordsOptions,
    mode: 'full' | 'summary',
  ): LaikaStream.LaikaStream<T, ListRecordsDone> {
    return LaikaStream.make<T, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        if (!options.folder) {
          return yield* Effect.fail(
            new BadRequestError(
              'listRecords requires `folder` (the collection name) to identify which collection to list',
            ),
          );
        }
        const { collection, remainder: subFolder } = this.parseKey(options.folder);
        if (!collection) {
          return yield* Effect.fail(
            new BadRequestError(`folder '${options.folder}' is missing a collection prefix`),
          );
        }
        const settings = yield* runForwarding(
          this.settingsProvider.getDocumentCollectionSettings(collection),
          emit,
        );

        let total = 0;

        // Published
        if (options.type === 'published' || options.type === undefined) {
          const directory = settings.directory ?? collection;
          const folderPath = subFolder ? pathCombine(directory, subFolder) : directory;
          const listOptions = { pagination: options.pagination, depth: options.depth };

          if (mode === 'full') {
            const { data: atoms, done } = yield* LaikaStream.runCollectForwarding(
              this.storageRepository.listAtoms(folderPath, listOptions),
              emit,
            );
            let emitted = 0;
            for (const atom of atoms) {
              if (atom.type !== 'object') continue;
              const k = this.extractKeyFromPath(atom.key, directory, collection);
              yield* emit.data({
                ...atom,
                key: k,
                type: 'published' as const,
                status: 'published' as const,
              } as unknown as T);
              emitted += 1;
            }
            total += done.total ?? emitted;
          } else {
            const { data: summaries, done } = yield* LaikaStream.runCollectForwarding(
              this.storageRepository.listAtomSummaries(folderPath, listOptions),
              emit,
            );
            let emitted = 0;
            for (const atom of summaries) {
              if (atom.type !== 'object-summary') continue;
              const k = this.extractKeyFromPath(atom.key, directory, collection);
              yield* emit.data({
                ...atom,
                key: k,
                type: 'published-summary' as const,
                status: 'published' as const,
              } as unknown as T);
              emitted += 1;
            }
            total += done.total ?? emitted;
          }
        }

        // Unpublished
        if (options.type === 'unpublished' || options.type === undefined) {
          const unpublishedStatuses = settings.unpublishedStatuses || {};
          const statusesToList = options.statuses || Object.keys(unpublishedStatuses);

          for (const status of statusesToList) {
            const statusConfig = unpublishedStatuses[status];
            if (!statusConfig) continue;

            const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
            const folderPath = subFolder ? pathCombine(basePath, subFolder) : basePath;
            const listOptions = { pagination: options.pagination, depth: options.depth };

            if (mode === 'full') {
              const r = yield* Effect.result(
                LaikaStream.runCollectForwarding(
                  this.storageRepository.listAtoms(folderPath, listOptions),
                  emit,
                ),
              );
              if (Result.isFailure(r)) {
                // Ignore NotFound for status dirs that don't exist yet.
                if (r.failure.code !== NotFoundError.CODE) yield* emit.recoverableError(r.failure);
                continue;
              }
              let emitted = 0;
              for (const atom of r.success.data) {
                if (atom.type !== 'object') continue;
                const k = this.extractKeyFromPath(atom.key, basePath, collection);
                yield* emit.data({
                  ...atom,
                  key: k,
                  type: 'unpublished' as const,
                  status,
                } as unknown as T);
                emitted += 1;
              }
              total += r.success.done.total ?? emitted;
            } else {
              const r = yield* Effect.result(
                LaikaStream.runCollectForwarding(
                  this.storageRepository.listAtomSummaries(folderPath, listOptions),
                  emit,
                ),
              );
              if (Result.isFailure(r)) {
                if (r.failure.code !== NotFoundError.CODE) yield* emit.recoverableError(r.failure);
                continue;
              }
              let emitted = 0;
              for (const atom of r.success.data) {
                if (atom.type !== 'object-summary') continue;
                const k = this.extractKeyFromPath(atom.key, basePath, collection);
                yield* emit.data({
                  ...atom,
                  key: k,
                  type: 'unpublished-summary' as const,
                  status,
                } as unknown as T);
                emitted += 1;
              }
              total += r.success.done.total ?? emitted;
            }
          }
        }

        return { total };
      })
    );
  }

  // ===== REVISIONS =====

  getRevision(key: string, revision: string): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(emit =>
      Effect.gen({ self: this }, function*() {
        const path = yield* this.getRevisionPath(key, emit, revision);
        const obj = yield* LaikaTask.runValueForwarding(this.storageRepository.getObject(path), emit);
        if (!obj.createdAt) {
          return yield* Effect.fail(new InvalidData('Revision is missing createdAt date'));
        }
        return {
          ...obj,
          createdAt: obj.createdAt,
          language: obj.content.language ?? 'und',
          revision,
          type: 'revision' as const,
          key,
        };
      })
    );
  }

  createRevision(create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(emit =>
      Effect.gen({ self: this }, function*() {
        if (typeof create.content !== 'object' || create.content === null || Array.isArray(create.content)) {
          return yield* Effect.fail(
            new BadRequestError(`createRevision: content must be a plain object; got ${typeof create.content}.`),
          );
        }
        const path = yield* this.getRevisionPath(create.key, emit, create.revision);
        const obj = yield* LaikaTask.runValueForwarding(
          this.storageRepository.createObject({
            type: 'object',
            key: path,
            content: { ...create.content, language: create.language },
          }),
          emit,
        ).pipe(
          Effect.mapError(e =>
            e instanceof EntryAlreadyExistsError
              ? new EntryAlreadyExistsError(`Already exists: ${create.key}/${create.revision}`)
              : e
          ),
        );
        const now = new Date().toISOString();
        return {
          ...obj,
          key: create.key,
          revision: create.revision,
          language: create.language,
          type: 'revision' as const,
          createdAt: now,
          updatedAt: now,
        };
      })
    );
  }

  listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone> {
    return LaikaStream.make<RevisionSummary, ListRevisionsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const revisionDirectory = yield* this.getRevisionPath(key, emit);
        const { data: atoms, done } = yield* LaikaStream.runCollectForwarding(
          this.storageRepository.listAtoms(revisionDirectory, {
            pagination: options.pagination,
            depth: 1,
          }),
          emit,
        );
        let emitted = 0;
        for (const atom of atoms) {
          if (atom.type !== 'object') continue;
          const revisionName = basename(atom.key);
          yield* emit.data(
            {
              ...atom,
              type: 'revision-summary' as const,
              revision: revisionName,
              language: atom.content.language ?? 'und',
              key,
            } satisfies RevisionSummary,
          );
          emitted += 1;
        }
        return { total: done.total ?? emitted };
      })
    );
  }
}
