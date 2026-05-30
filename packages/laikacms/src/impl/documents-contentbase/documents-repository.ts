import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import type { ContentBaseSettingsProvider } from 'laikacms/contentbase-settings';
import type { LaikaDone, LaikaError, LaikaResult } from 'laikacms/core';
import { BadRequestError, InvalidData, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
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
import type { StorageRepository } from 'laikacms/storage';
import { basename, pathCombine, pathToSegments } from 'laikacms/storage';

/**
 * Lift a Promise<LaikaResult<A>> into Effect<A, LaikaError> — bridges the
 * private path helpers (which still return Promise<Result>) into Effect.gen.
 */
const liftPromiseResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

/**
 * Drain first value from AsyncGenerator<LaikaResult<A>> and lift into Effect<A, LaikaError>.
 */
const liftAsyncGenResult = <A>(gen: AsyncGenerator<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  liftPromiseResult(
    (async () => {
      for await (const result of gen) return result;
      return Result.fail(new BadRequestError('No result from generator') as LaikaError) as LaikaResult<A>;
    })(),
  );

/** Run a LaikaStream and collect data into a flat array. */
const collectStreamData = <A, D extends LaikaDone, R>(
  stream: LaikaStream.LaikaStream<A, D, R>,
): Effect.Effect<ReadonlyArray<A>, LaikaError, R> => Effect.map(LaikaStream.runCollect(stream), r => r.data);

export class ContentBaseDocumentsRepository extends DocumentsRepository {
  constructor(
    private readonly storageRepository: StorageRepository,
    private readonly settingsProvider: ContentBaseSettingsProvider,
  ) {
    super();
  }

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.make<DocumentsCapabilities>(() =>
      Effect.gen({ self: this }, function*() {
        const caps = yield* LaikaTask.runValue(this.storageRepository.getCapabilities());
        return {
          compatibilityDate: DocumentsCompatibilityDate.make('2026-05-11'),
          pagination: caps.pagination,
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

  private async getDocumentPath(key: string): Promise<LaikaResult<string>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
    }
    let settings: LaikaResult<{ directory?: string }> | undefined;
    for await (const r of this.settingsProvider.getDocumentCollectionSettings(collection)) {
      settings = r as LaikaResult<{ directory?: string }>;
      break;
    }
    if (!settings) return Result.fail(new BadRequestError(`No settings for collection '${collection}'`));
    if (Result.isFailure(settings)) return Result.fail(settings.failure);
    const directory = settings.success.directory ?? collection;
    return Result.succeed(remainder ? pathCombine(directory, remainder) : directory);
  }

  private async getUnpublishedPath(key: string, status: string): Promise<LaikaResult<string>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
    }
    let settings: LaikaResult<{ unpublishedStatuses?: { [k: string]: { directory: string } } }> | undefined;
    for await (const r of this.settingsProvider.getDocumentCollectionSettings(collection)) {
      settings = r as LaikaResult<{ unpublishedStatuses?: { [k: string]: { directory: string } } }>;
      break;
    }
    if (!settings) return Result.fail(new BadRequestError(`No settings for collection '${collection}'`));
    if (Result.isFailure(settings)) return Result.fail(settings.failure);

    const unpublishedStatuses = settings.success.unpublishedStatuses || {};
    const statusConfig = unpublishedStatuses[status];
    if (!statusConfig) {
      return Result.fail(
        new BadRequestError(
          `Unknown unpublished status '${status}' for collection '${collection}'. `
            + `Available statuses: ${Object.keys(unpublishedStatuses).join(', ')}`,
        ),
      );
    }

    const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
    return Result.succeed(remainder ? pathCombine(basePath, remainder) : basePath);
  }

  private async getRevisionPath(key: string, revision?: string): Promise<LaikaResult<string>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
    }
    let settings: LaikaResult<{ revisionDirectory?: string }> | undefined;
    for await (const r of this.settingsProvider.getDocumentCollectionSettings(collection)) {
      settings = r as LaikaResult<{ revisionDirectory?: string }>;
      break;
    }
    if (!settings) return Result.fail(new BadRequestError(`No settings for collection '${collection}'`));
    if (Result.isFailure(settings)) return Result.fail(settings.failure);
    const revisionDirectory = settings.success.revisionDirectory || `.contentbase/${collection}/revisions`;
    const basePath = remainder ? pathCombine(revisionDirectory, remainder) : revisionDirectory;
    return Result.succeed(revision ? pathCombine(basePath, revision) : basePath);
  }

  private extractKeyFromPath(fullPath: string, directory: string, collection: string): string {
    const stripped = fullPath.startsWith(directory) ? fullPath.substring(directory.length) : fullPath;
    const segments = pathToSegments(stripped);
    return segments.length > 0 ? pathCombine(collection, ...segments) : collection;
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  getDocument(key: string): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getDocumentPath(key));
        const obj = yield* LaikaTask.runValue(this.storageRepository.getObject(path));
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
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getDocumentPath(create.key));
        const obj = yield* LaikaTask.runValue(this.storageRepository.createObject({
          type: 'object',
          key: path,
          content: create.content,
        }));
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
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getDocumentPath(update.key));
        const existing = yield* LaikaTask.runValue(this.getDocument(update.key));
        const newContent = update.content ?? existing.content;
        yield* LaikaTask.runValue(this.storageRepository.updateObject({
          key: path,
          content: newContent,
        }));
        return {
          ...existing,
          content: newContent,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  deleteDocument(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getDocumentPath(key));
        yield* collectStreamData(this.storageRepository.removeAtoms([path]));
      })
    );
  }

  // ===== UNPUBLISHED =====

  getUnpublished(key: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const { collection, remainder } = this.parseKey(key);
        if (!collection) {
          return yield* Effect.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
        }
        const settings = yield* liftAsyncGenResult(
          this.settingsProvider.getDocumentCollectionSettings(collection),
        );
        const unpublishedStatuses = settings.unpublishedStatuses || {};

        for (const [status, statusConfig] of Object.entries(unpublishedStatuses)) {
          const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
          const fullPath = remainder ? pathCombine(basePath, remainder) : basePath;
          const r = yield* Effect.result(LaikaTask.runValue(this.storageRepository.getObject(fullPath)));
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
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getUnpublishedPath(create.key, create.status));
        const obj = yield* LaikaTask.runValue(this.storageRepository.createObject({
          type: 'object',
          key: path,
          content: create.content,
        }));
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
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValue(this.getUnpublished(update.key));
        const newContent = update.content || existing.content;

        if (update.status && update.status !== existing.status) {
          return yield* LaikaTask.runValue(this.updateUnpublishedStatus(update.key, update.status));
        }

        const path = yield* liftPromiseResult(this.getUnpublishedPath(update.key, existing.status));
        yield* LaikaTask.runValue(this.storageRepository.updateObject({
          key: path,
          content: newContent,
        }));
        return {
          ...existing,
          content: newContent,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  /** Move an unpublished document to a different status directory. */
  private updateUnpublishedStatus(key: string, newStatus: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValue(this.getUnpublished(key));
        const oldPath = yield* liftPromiseResult(this.getUnpublishedPath(key, existing.status));
        const newPath = yield* liftPromiseResult(this.getUnpublishedPath(key, newStatus));

        yield* LaikaTask.runValue(this.storageRepository.createObject({
          type: 'object',
          key: newPath,
          content: existing.content,
        }));
        yield* collectStreamData(this.storageRepository.removeAtoms([oldPath]));

        return {
          ...existing,
          status: newStatus,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }

  deleteUnpublished(key: string): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValue(this.getUnpublished(key));
        const path = yield* liftPromiseResult(this.getUnpublishedPath(key, existing.status));
        yield* collectStreamData(this.storageRepository.removeAtoms([path]));
      })
    );
  }

  unpublish(key: string, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const document = yield* LaikaTask.runValue(this.getDocument(key));
        const documentPath = yield* liftPromiseResult(this.getDocumentPath(key));
        const unpublishedPath = yield* liftPromiseResult(this.getUnpublishedPath(key, status));

        yield* LaikaTask.runValue(this.storageRepository.createObject({
          type: 'object',
          key: unpublishedPath,
          content: document.content,
        }));
        yield* collectStreamData(this.storageRepository.removeAtoms([documentPath]));

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
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const unpublished = yield* LaikaTask.runValue(this.getUnpublished(key));
        const unpublishedPath = yield* liftPromiseResult(this.getUnpublishedPath(key, unpublished.status));
        const documentPath = yield* liftPromiseResult(this.getDocumentPath(key));

        yield* LaikaTask.runValue(this.storageRepository.createObject({
          type: 'object',
          key: documentPath,
          content: unpublished.content,
        }));
        yield* collectStreamData(this.storageRepository.removeAtoms([unpublishedPath]));

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
        const settings = yield* liftAsyncGenResult(
          this.settingsProvider.getDocumentCollectionSettings(collection),
        );

        let total = 0;

        // Published
        if (options.type === 'published' || options.type === undefined) {
          const directory = settings.directory ?? collection;
          const folderPath = subFolder ? pathCombine(directory, subFolder) : directory;
          const listOptions = { pagination: options.pagination, depth: options.depth };

          if (mode === 'full') {
            const atoms = yield* collectStreamData(
              this.storageRepository.listAtoms(folderPath, listOptions),
            );
            for (const atom of atoms) {
              if (atom.type !== 'object') continue;
              const k = this.extractKeyFromPath(atom.key, directory, collection);
              yield* emit.data({
                ...atom,
                key: k,
                type: 'published' as const,
                status: 'published' as const,
              } as unknown as T);
              total += 1;
            }
          } else {
            const summaries = yield* collectStreamData(
              this.storageRepository.listAtomSummaries(folderPath, listOptions),
            );
            for (const atom of summaries) {
              if (atom.type !== 'object-summary') continue;
              const k = this.extractKeyFromPath(atom.key, directory, collection);
              yield* emit.data({
                ...atom,
                key: k,
                type: 'published-summary' as const,
                status: 'published' as const,
              } as unknown as T);
              total += 1;
            }
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
                collectStreamData(this.storageRepository.listAtoms(folderPath, listOptions)),
              );
              if (Result.isFailure(r)) {
                // Ignore NotFound for status dirs that don't exist yet.
                if (r.failure.code !== NotFoundError.CODE) yield* emit.recoverableError(r.failure);
                continue;
              }
              for (const atom of r.success) {
                if (atom.type !== 'object') continue;
                const k = this.extractKeyFromPath(atom.key, basePath, collection);
                yield* emit.data({
                  ...atom,
                  key: k,
                  type: 'unpublished' as const,
                  status,
                } as unknown as T);
                total += 1;
              }
            } else {
              const r = yield* Effect.result(
                collectStreamData(this.storageRepository.listAtomSummaries(folderPath, listOptions)),
              );
              if (Result.isFailure(r)) {
                if (r.failure.code !== NotFoundError.CODE) yield* emit.recoverableError(r.failure);
                continue;
              }
              for (const atom of r.success) {
                if (atom.type !== 'object-summary') continue;
                const k = this.extractKeyFromPath(atom.key, basePath, collection);
                yield* emit.data({
                  ...atom,
                  key: k,
                  type: 'unpublished-summary' as const,
                  status,
                } as unknown as T);
                total += 1;
              }
            }
          }
        }

        return { total };
      })
    );
  }

  // ===== REVISIONS =====

  getRevision(key: string, revision: string): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getRevisionPath(key, revision));
        const obj = yield* LaikaTask.runValue(this.storageRepository.getObject(path));
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
    return LaikaTask.make<Revision>(() =>
      Effect.gen({ self: this }, function*() {
        const path = yield* liftPromiseResult(this.getRevisionPath(create.key, create.revision));
        const obj = yield* LaikaTask.runValue(this.storageRepository.createObject({
          type: 'object',
          key: path,
          content: create.content,
        }));
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
        const revisionDirectory = yield* liftPromiseResult(this.getRevisionPath(key));
        const atoms = yield* collectStreamData(
          this.storageRepository.listAtoms(revisionDirectory, {
            pagination: options.pagination,
            depth: 1,
          }),
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
        return { total: emitted };
      })
    );
  }
}
