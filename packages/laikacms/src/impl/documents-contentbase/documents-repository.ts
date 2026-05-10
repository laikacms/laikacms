import type { ContentBaseSettingsProvider } from '@laikacms/contentbase-settings';
import type { LaikaError, LaikaResult } from '@laikacms/core';
import { BadRequestError, InvalidData, NotFoundError } from '@laikacms/core';
import type {
  ListRecordsOptions,
  ListRecordSummaries,
  ListRevisionsOptions,
  RecordSummary,
  RevisionSummary,
} from '@laikacms/documents';
import {
  type Document,
  type DocumentCreate,
  DocumentsRepository,
  type DocumentUpdate,
  type Record,
  type Revision,
  type RevisionCreate,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedUpdate,
} from '@laikacms/documents';
import type { StorageRepository } from '@laikacms/storage';
import { basename, pathCombine, pathToSegments } from '@laikacms/storage';
import * as Result from 'effect/Result';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/**
 * Helper to get the first result from an async generator
 */
async function firstResult<T>(gen: AsyncGenerator<LaikaResult<T>>): Promise<LaikaResult<T>> {
  for await (const result of gen) {
    return result;
  }
  return Result.fail(new NotFoundError('No result from generator'));
}

export class ContentBaseDocumentsRepository extends DocumentsRepository {
  constructor(
    private readonly storageRepository: StorageRepository,
    private readonly settingsProvider: ContentBaseSettingsProvider,
  ) {
    super();
  }

  /**
   * Split a document key into its collection prefix and the remainder. Keys are always
   * `<collection>/<rest>`; the collection is the first path segment and corresponds to
   * a configured `DocumentCollectionSettings`. The remainder is everything after — it may
   * be empty (the collection root) or contain further nested segments.
   */
  private parseKey(key: string): { collection: string, remainder: string } {
    const segments = pathToSegments(key);
    if (segments.length === 0) {
      return { collection: '', remainder: '' };
    }
    const [collection, ...rest] = segments;
    return { collection, remainder: rest.length > 0 ? pathCombine(...rest) : '' };
  }

  /**
   * Get the storage path for a document by looking up its collection's directory in settings.
   */
  private async getDocumentPath(key: string): Promise<LaikaResult<string>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
    }
    const settings = await this.settingsProvider.getDocumentCollectionSettings(collection);
    if (Result.isFailure(settings)) {
      return failAs<string>(settings.failure);
    }
    const directory = settings.success.directory ?? collection;
    return Result.succeed(remainder ? pathCombine(directory, remainder) : directory);
  }

  /**
   * Get the storage path for an unpublished document with a specific status
   */
  private async getUnpublishedPath(
    key: string,
    status: string,
  ): Promise<LaikaResult<string>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
    }
    const settings = await this.settingsProvider.getDocumentCollectionSettings(collection);
    if (Result.isFailure(settings)) {
      return failAs<string>(settings.failure);
    }

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

    // Path format: .contentbase/[collection]/[status.directory]/[remainder]
    const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
    return Result.succeed(remainder ? pathCombine(basePath, remainder) : basePath);
  }

  /**
   * Get the storage path for a revision
   */
  private async getRevisionPath(
    key: string,
    revision?: string,
  ): Promise<LaikaResult<string>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      return Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
    }
    const settings = await this.settingsProvider.getDocumentCollectionSettings(collection);
    if (Result.isFailure(settings)) {
      return failAs<string>(settings.failure);
    }

    const revisionDirectory = settings.success.revisionDirectory || `.contentbase/${collection}/revisions`;
    const basePath = remainder ? pathCombine(revisionDirectory, remainder) : revisionDirectory;

    if (revision) {
      return Result.succeed(pathCombine(basePath, revision));
    }
    return Result.succeed(basePath);
  }

  /**
   * Convert a full storage path back to a logical key by stripping the collection's
   * directory prefix and re-attaching the collection name.
   */
  private extractKeyFromPath(fullPath: string, directory: string, collection: string): string {
    const stripped = fullPath.startsWith(directory) ? fullPath.substring(directory.length) : fullPath;
    const segments = pathToSegments(stripped);
    return segments.length > 0 ? pathCombine(collection, ...segments) : collection;
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  async *getDocument(key: string): AsyncGenerator<LaikaResult<Document>> {
    const pathResult = await this.getDocumentPath(key);
    if (Result.isFailure(pathResult)) {
      yield failAs<Document>(pathResult.failure);
      return;
    }

    const result = await firstResult(this.storageRepository.getObject(pathResult.success));
    if (Result.isFailure(result)) {
      yield failAs<Document>(result.failure);
      return;
    }

    const document: Document = {
      ...result.success,
      key,
      type: 'published',
      language: result.success.content.language ?? 'und',
      status: 'published',
    };

    yield Result.succeed(document);
  }

  async *createDocument(create: DocumentCreate): AsyncGenerator<LaikaResult<Document>> {
    const pathResult = await this.getDocumentPath(create.key);
    if (Result.isFailure(pathResult)) {
      yield failAs<Document>(pathResult.failure);
      return;
    }

    const now = new Date().toISOString();

    const object = await firstResult(this.storageRepository.createObject({
      type: 'object',
      key: pathResult.success,
      content: create.content,
    }));

    if (Result.isFailure(object)) {
      yield failAs<Document>(object.failure);
      return;
    }

    const document: Document = {
      ...object.success,
      key: create.key,
      type: 'published',
      status: 'published',
      language: create.language,
      createdAt: now,
      updatedAt: now,
    };

    yield Result.succeed(document);
  }

  async *updateDocument(update: DocumentUpdate): AsyncGenerator<LaikaResult<Document>> {
    const pathResult = await this.getDocumentPath(update.key);
    if (Result.isFailure(pathResult)) {
      yield failAs<Document>(pathResult.failure);
      return;
    }

    // Get existing document to preserve createdAt
    const existingResult = await firstResult(this.getDocument(update.key));
    if (Result.isFailure(existingResult)) {
      yield failAs<Document>(existingResult.failure);
      return;
    }

    const existing = existingResult.success;
    const newContent = update.content ?? existing.content;

    const result = await firstResult(this.storageRepository.updateObject({
      key: pathResult.success,
      content: newContent,
    }));
    if (Result.isFailure(result)) {
      yield failAs<Document>(result.failure);
      return;
    }

    const document: Document = {
      ...existing,
      content: newContent,
      updatedAt: new Date().toISOString(),
    };

    yield Result.succeed(document);
  }

  async *deleteDocument(key: string): AsyncGenerator<LaikaResult<void>> {
    // Get paths
    const documentPath = await this.getDocumentPath(key);
    if (Result.isFailure(documentPath)) {
      yield failAs<void>(documentPath.failure);
      return;
    }

    // Permanently delete the document
    for await (const result of this.storageRepository.removeAtoms([documentPath.success])) {
      if (Result.isFailure(result)) {
        yield failAs<void>(result.failure);
        return;
      }
    }

    yield Result.succeed(undefined);
  }

  // ===== UNPUBLISHED =====

  async *getUnpublished(key: string): AsyncGenerator<LaikaResult<Unpublished>> {
    const { collection, remainder } = this.parseKey(key);
    if (!collection) {
      yield Result.fail(new BadRequestError(`Document key '${key}' is missing a collection prefix`));
      return;
    }
    const settings = await this.settingsProvider.getDocumentCollectionSettings(collection);
    if (Result.isFailure(settings)) {
      yield failAs<Unpublished>(settings.failure);
      return;
    }

    const unpublishedStatuses = settings.success.unpublishedStatuses || {};

    // Try each status directory to find the unpublished document
    for (const [status, statusConfig] of Object.entries(unpublishedStatuses)) {
      const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
      const fullPath = remainder ? pathCombine(basePath, remainder) : basePath;

      const result = await firstResult(this.storageRepository.getObject(fullPath));
      if (Result.isSuccess(result)) {
        const unpublished: Unpublished = {
          ...result.success,
          key,
          type: 'unpublished',
          language: result.success.content.language ?? 'und',
          status,
        };
        yield Result.succeed(unpublished);
        return;
      }
    }

    yield Result.fail(new NotFoundError(`Unpublished document '${key}' not found in collection '${collection}'`));
  }

  async *createUnpublished(create: UnpublishedCreate): AsyncGenerator<LaikaResult<Unpublished>> {
    const pathResult = await this.getUnpublishedPath(create.key, create.status);
    if (Result.isFailure(pathResult)) {
      yield failAs<Unpublished>(pathResult.failure);
      return;
    }

    const now = new Date().toISOString();

    const object = await firstResult(this.storageRepository.createObject({
      type: 'object',
      key: pathResult.success,
      content: create.content,
    }));

    if (Result.isFailure(object)) {
      yield failAs<Unpublished>(object.failure);
      return;
    }

    const unpublished: Unpublished = {
      ...object.success,
      key: create.key,
      type: 'unpublished',
      status: create.status,
      language: create.language,
      createdAt: now,
      updatedAt: now,
    };

    yield Result.succeed(unpublished);
  }

  async *updateUnpublished(update: UnpublishedUpdate): AsyncGenerator<LaikaResult<Unpublished>> {
    // Get the existing unpublished document
    const existingResult = await firstResult(this.getUnpublished(update.key));
    if (Result.isFailure(existingResult)) {
      yield failAs<Unpublished>(existingResult.failure);
      return;
    }

    const existing = existingResult.success;
    const newContent = update.content || existing.content;

    // If status is changing, we need to move the file
    if (update.status && update.status !== existing.status) {
      yield* this.updateUnpublishedStatus(update.key, update.status);
      return;
    }

    // Just update content in place
    const pathResult = await this.getUnpublishedPath(update.key, existing.status);
    if (Result.isFailure(pathResult)) {
      yield failAs<Unpublished>(pathResult.failure);
      return;
    }

    const result = await firstResult(this.storageRepository.updateObject({
      key: pathResult.success,
      content: newContent,
    }));
    if (Result.isFailure(result)) {
      yield failAs<Unpublished>(result.failure);
      return;
    }

    const unpublished: Unpublished = {
      ...existing,
      content: newContent,
      updatedAt: new Date().toISOString(),
    };

    yield Result.succeed(unpublished);
  }

  /**
   * Update the status of an unpublished document (moves it to a different directory)
   */
  private async *updateUnpublishedStatus(key: string, newStatus: string): AsyncGenerator<LaikaResult<Unpublished>> {
    // Get the existing unpublished document
    const existingResult = await firstResult(this.getUnpublished(key));
    if (Result.isFailure(existingResult)) {
      yield failAs<Unpublished>(existingResult.failure);
      return;
    }

    const existing = existingResult.success;

    // Get paths
    const oldPath = await this.getUnpublishedPath(key, existing.status);
    if (Result.isFailure(oldPath)) {
      yield failAs<Unpublished>(oldPath.failure);
      return;
    }

    const newPath = await this.getUnpublishedPath(key, newStatus);
    if (Result.isFailure(newPath)) {
      yield failAs<Unpublished>(newPath.failure);
      return;
    }

    const now = new Date().toISOString();

    // Create in new location
    const createResult = await firstResult(this.storageRepository.createObject({
      type: 'object',
      key: newPath.success,
      content: existing.content,
    }));
    if (Result.isFailure(createResult)) {
      yield failAs<Unpublished>(createResult.failure);
      return;
    }

    // Remove from old location
    for await (const result of this.storageRepository.removeAtoms([oldPath.success])) {
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }
    }

    const unpublished: Unpublished = {
      ...existing,
      status: newStatus,
      updatedAt: now,
    };

    yield Result.succeed(unpublished);
  }

  async *deleteUnpublished(key: string): AsyncGenerator<LaikaResult<void>> {
    // Get the existing unpublished document to find its status
    const existingResult = await firstResult(this.getUnpublished(key));
    if (Result.isFailure(existingResult)) {
      yield failAs<void>(existingResult.failure);
      return;
    }

    const pathResult = await this.getUnpublishedPath(key, existingResult.success.status);
    if (Result.isFailure(pathResult)) {
      yield failAs<void>(pathResult.failure);
      return;
    }

    for await (const result of this.storageRepository.removeAtoms([pathResult.success])) {
      if (Result.isFailure(result)) {
        yield failAs<void>(result.failure);
        return;
      }
    }

    yield Result.succeed(undefined);
  }

  async *unpublish(key: string, status: string): AsyncGenerator<LaikaResult<Unpublished>> {
    // Get the document
    const documentResult = await firstResult(this.getDocument(key));
    if (Result.isFailure(documentResult)) {
      yield failAs<Unpublished>(documentResult.failure);
      return;
    }

    const document = documentResult.success;

    // Get paths
    const documentPath = await this.getDocumentPath(key);
    if (Result.isFailure(documentPath)) {
      yield failAs<Unpublished>(documentPath.failure);
      return;
    }

    const unpublishedPath = await this.getUnpublishedPath(key, status);
    if (Result.isFailure(unpublishedPath)) {
      yield failAs<Unpublished>(unpublishedPath.failure);
      return;
    }

    const now = new Date().toISOString();

    // Write to unpublished location
    const createResult = await firstResult(this.storageRepository.createObject({
      type: 'object',
      key: unpublishedPath.success,
      content: document.content,
    }));
    if (Result.isFailure(createResult)) {
      yield failAs<Unpublished>(createResult.failure);
      return;
    }

    // Remove from documents
    for await (const result of this.storageRepository.removeAtoms([documentPath.success])) {
      if (Result.isFailure(result)) {
        yield failAs<Unpublished>(result.failure);
        return;
      }
    }

    const unpublished: Unpublished = {
      key,
      type: 'unpublished',
      status,
      language: document.language,
      content: document.content,
      createdAt: document.createdAt,
      updatedAt: now,
    };

    yield Result.succeed(unpublished);
  }

  async *publish(key: string): AsyncGenerator<LaikaResult<Document>> {
    // Get the unpublished document
    const unpublishedResult = await firstResult(this.getUnpublished(key));
    if (Result.isFailure(unpublishedResult)) {
      yield failAs<Document>(unpublishedResult.failure);
      return;
    }

    const unpublished = unpublishedResult.success;

    // Get paths
    const unpublishedPath = await this.getUnpublishedPath(key, unpublished.status);
    if (Result.isFailure(unpublishedPath)) {
      yield failAs<Document>(unpublishedPath.failure);
      return;
    }

    const documentPath = await this.getDocumentPath(key);
    if (Result.isFailure(documentPath)) {
      yield failAs<Document>(documentPath.failure);
      return;
    }

    const now = new Date().toISOString();

    // Write to documents
    const createResult = await firstResult(this.storageRepository.createObject({
      type: 'object',
      key: documentPath.success,
      content: unpublished.content,
    }));
    if (Result.isFailure(createResult)) {
      yield failAs<Document>(createResult.failure);
      return;
    }

    // Remove from unpublished
    for await (const result of this.storageRepository.removeAtoms([unpublishedPath.success])) {
      if (Result.isFailure(result)) {
        yield failAs<Document>(result.failure);
        return;
      }
    }

    const document: Document = {
      key,
      type: 'published',
      status: 'published',
      language: unpublished.language,
      content: unpublished.content,
      createdAt: unpublished.createdAt,
      updatedAt: now,
    };

    yield Result.succeed(document);
  }

  // ===== RECORDS (LIST ALL TYPES) =====

  /**
   * Private helper to list records with configurable output type.
   *
   * `options.folder` is interpreted as the collection name (its first path segment) plus an
   * optional sub-path. The collection's directory is taken from settings; the optional
   * sub-path is appended to scope listing within the collection.
   */
  private async *listRecordsInternal<T extends 'full' | 'summary'>(
    options: ListRecordsOptions,
    mode: T,
  ): AsyncGenerator<LaikaResult<readonly (T extends 'full' ? Record : RecordSummary)[]>> {
    if (!options.folder) {
      yield Result.fail(
        new BadRequestError('listRecords requires `folder` (the collection name) to identify which collection to list'),
      );
      return;
    }
    const { collection, remainder: subFolder } = this.parseKey(options.folder);
    if (!collection) {
      yield Result.fail(new BadRequestError(`folder '${options.folder}' is missing a collection prefix`));
      return;
    }
    const settings = await this.settingsProvider.getDocumentCollectionSettings(collection);
    if (Result.isFailure(settings)) {
      yield failAs<readonly (T extends 'full' ? Record : RecordSummary)[]>(settings.failure);
      return;
    }

    // List documents if requested
    if (options.type === 'published' || options.type === undefined) {
      const directory = settings.success.directory ?? collection;
      const folderPath = subFolder ? pathCombine(directory, subFolder) : directory;

      const listOptions = {
        pagination: options.pagination,
        depth: options.depth,
      };

      if (mode === 'full') {
        for await (const atoms of this.storageRepository.listAtoms(folderPath, listOptions)) {
          if (Result.isFailure(atoms)) {
            yield failAs<readonly (T extends 'full' ? Record : RecordSummary)[]>(atoms.failure);
            continue;
          }

          const items = atoms.success
            .filter(atom => atom.type === 'object')
            .map(atom => {
              const key = this.extractKeyFromPath(atom.key, directory, collection);
              return {
                ...atom,
                key,
                type: 'published' as const,
                status: 'published' as const,
              };
            });

          yield Result.succeed(items as any) as any;
        }
      } else {
        for await (const atoms of this.storageRepository.listAtomSummaries(folderPath, listOptions)) {
          if (Result.isFailure(atoms)) {
            yield failAs<readonly (T extends 'full' ? Record : RecordSummary)[]>(atoms.failure);
            continue;
          }

          const items = atoms.success
            .filter(atom => atom.type === 'object-summary')
            .map(atom => {
              const key = this.extractKeyFromPath(atom.key, directory, collection);
              return {
                ...atom,
                key,
                type: 'published-summary' as const,
                status: 'published' as const,
              };
            });

          yield Result.succeed(items as any) as any;
        }
      }
    }

    // List unpublished if requested
    if (options.type === 'unpublished' || options.type === undefined) {
      const unpublishedStatuses = settings.success.unpublishedStatuses || {};
      const statusesToList = options.statuses || Object.keys(unpublishedStatuses);

      for (const status of statusesToList) {
        const statusConfig = unpublishedStatuses[status];
        if (!statusConfig) continue;

        const basePath = `.contentbase/${collection}/${statusConfig.directory}`;
        const folderPath = subFolder ? pathCombine(basePath, subFolder) : basePath;

        const listOptions = {
          pagination: options.pagination,
          depth: options.depth,
        };

        if (mode === 'full') {
          for await (const atoms of this.storageRepository.listAtoms(folderPath, listOptions)) {
            if (Result.isFailure(atoms)) {
              // Ignore not found errors for unpublished directories that don't exist yet
              if (atoms.failure.code === NotFoundError.CODE) continue;
              yield failAs<readonly (T extends 'full' ? Record : RecordSummary)[]>(atoms.failure);
              continue;
            }

            const items = atoms.success
              .filter(atom => atom.type === 'object')
              .map(atom => {
                const key = this.extractKeyFromPath(atom.key, basePath, collection);
                return {
                  ...atom,
                  key,
                  type: 'unpublished' as const,
                  status,
                };
              });

            yield Result.succeed(items as any) as any;
          }
        } else {
          for await (const atoms of this.storageRepository.listAtomSummaries(folderPath, listOptions)) {
            if (Result.isFailure(atoms)) {
              // Ignore not found errors for unpublished directories that don't exist yet
              if (atoms.failure.code === NotFoundError.CODE) continue;
              yield failAs<readonly (T extends 'full' ? Record : RecordSummary)[]>(atoms.failure);
              continue;
            }

            const items = atoms.success
              .filter(atom => atom.type === 'object-summary')
              .map(atom => {
                const key = this.extractKeyFromPath(atom.key, basePath, collection);
                return {
                  ...atom,
                  key,
                  type: 'unpublished-summary' as const,
                  status,
                };
              });

            yield Result.succeed(items as any) as any;
          }
        }
      }
    }
  }

  /**
   * List full record objects with content
   */
  async *listRecords(options: ListRecordsOptions): AsyncGenerator<LaikaResult<readonly Record[]>> {
    yield* this.listRecordsInternal(options, 'full');
  }

  /**
   * List record summaries (without content) for efficient listing
   */
  async *listRecordSummaries(options: ListRecordSummaries): AsyncGenerator<LaikaResult<readonly RecordSummary[]>> {
    yield* this.listRecordsInternal(options, 'summary');
  }

  // ===== REVISIONS =====

  async *getRevision(key: string, revision: string): AsyncGenerator<LaikaResult<Revision>> {
    const pathResult = await this.getRevisionPath(key, revision);
    if (Result.isFailure(pathResult)) {
      yield failAs<Revision>(pathResult.failure);
      return;
    }

    const result = await firstResult(this.storageRepository.getObject(pathResult.success));
    if (Result.isFailure(result)) {
      yield failAs<Revision>(result.failure);
      return;
    }

    if (!result.success.createdAt) {
      yield Result.fail(new InvalidData('Revision is missing createdAt date'));
      return;
    }

    const revisionEntry: Revision = {
      ...result.success,
      createdAt: result.success.createdAt,
      language: result.success.content.language ?? 'und',
      revision,
      type: 'revision',
      key,
    };

    yield Result.succeed(revisionEntry);
  }

  async *createRevision(create: RevisionCreate): AsyncGenerator<LaikaResult<Revision>> {
    const pathResult = await this.getRevisionPath(create.key, create.revision);
    if (Result.isFailure(pathResult)) {
      yield failAs<Revision>(pathResult.failure);
      return;
    }

    const now = new Date().toISOString();

    const object = await firstResult(this.storageRepository.createObject({
      type: 'object',
      key: pathResult.success,
      content: create.content,
    }));

    if (Result.isFailure(object)) {
      yield failAs<Revision>(object.failure);
      return;
    }

    const revision: Revision = {
      ...object.success,
      key: create.key,
      revision: create.revision,
      language: create.language,
      type: 'revision',
      createdAt: now,
      updatedAt: now,
    };

    yield Result.succeed(revision);
  }

  async *listRevisions(
    key: string,
    options: ListRevisionsOptions,
  ): AsyncGenerator<LaikaResult<readonly RevisionSummary[]>> {
    const pathResult = await this.getRevisionPath(key);
    if (Result.isFailure(pathResult)) {
      yield failAs<readonly RevisionSummary[]>(pathResult.failure);
      return;
    }

    const revisionDirectory = pathResult.success;

    const generator = this.storageRepository.listAtoms(revisionDirectory, {
      pagination: options.pagination,
      depth: 1,
    });

    for await (const result of generator) {
      if (Result.isFailure(result)) {
        yield failAs<readonly RevisionSummary[]>(result.failure);
        continue;
      }

      const summaries = result.success
        .filter(atom => atom.type === 'object')
        .map(atom => {
          const revisionName = basename(atom.key);
          return {
            ...atom,
            type: 'revision-summary' as const,
            revision: revisionName,
            language: atom.content.language ?? 'und',
            key,
          } satisfies RevisionSummary;
        });

      yield Result.succeed(summaries);
    }
  }
}
