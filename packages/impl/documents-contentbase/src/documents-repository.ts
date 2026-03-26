import { AtomSummary, basename, pathToSegments, StorageRepository, pathCombine } from "@laikacms/storage";
import {
  Result,
  success,
  failure,
  NotFoundError,
  InvalidData,
  IllegalStateException,
  BadRequestError,
} from "@laikacms/core";
import {
  type Revision,
  type Document,
  type Unpublished,
  type UnpublishedCreate,
  type UnpublishedUpdate,
  type Record,
  type DocumentCreate,
  type DocumentUpdate,
  type RevisionCreate,
  DocumentsRepository,
  RevisionSummary,
  ListRevisionsOptions,
  ListRecordsOptions,
  ListRecordSummaries,
  documentSummaryZ,
  revisionSummaryZ,
  DocumentSummary,
  unpublishedSummaryZ,
  UnpublishedSummary,
  RecordSummary,
} from "@laikacms/documents";
import { ContentBaseSettingsProvider, DocumentCollectionSettings } from "@laikacms/contentbase-settings";

export class ContentBaseDocumentsRepository extends DocumentsRepository {
  constructor(
    private readonly collection: string,
    private readonly storageRepository: StorageRepository,
    private readonly settingsProvider: ContentBaseSettingsProvider
  ) {
    super();
  }

  /**
   * Get the storage path for a document
   */
  private async getDocumentPath(key: string): Promise<Result<string>> {
    const settings = await this.settingsProvider.getDocumentCollectionSettings(this.collection);
    if (!settings.success) return settings;
    return success(pathCombine(settings.data.directory, key));
  }

  /**
   * Get the storage path for an unpublished document with a specific status
   */
  private async getUnpublishedPath(
    key: string,
    status: string
  ): Promise<Result<string>> {
    const settings = await this.settingsProvider.getDocumentCollectionSettings(this.collection);
    if (!settings.success) return settings;

    const unpublishedStatuses = settings.data.unpublishedStatuses || {};
    const statusConfig = unpublishedStatuses[status];

    if (!statusConfig) {
      return failure(BadRequestError.CODE, [
        `Unknown unpublished status '${status}' for collection '${this.collection}'. ` +
        `Available statuses: ${Object.keys(unpublishedStatuses).join(', ')}`
      ]);
    }

    // Path format: .contentbase/[collection]/[status.directory]/[key]
    const basePath = `.contentbase/${this.collection}/${statusConfig.directory}`;
    return success(pathCombine(basePath, key));
  }

  /**
   * Get the storage path for a revision
   */
  private async getRevisionPath(
    key: string,
    revision?: string
  ): Promise<Result<string>> {
    const settings = await this.settingsProvider.getDocumentCollectionSettings(this.collection);
    if (!settings.success) return settings;

    const revisionDirectory = settings.data.revisionDirectory || `.contentbase/${this.collection}/revisions`;
    const basePath = pathCombine(revisionDirectory, key);
    
    if (revision) {
      return success(pathCombine(basePath, revision));
    }
    return success(basePath);
  }

  /**
   * Extract key from a full storage path
   */
  private extractKeyFromPath(fullPath: string, directory: string): string {
    const segments = pathToSegments(fullPath.substring(directory.length));
    return pathCombine(...segments);
  }

  // ===== DOCUMENTS (PUBLISHED) =====

  async getDocument(key: string): Promise<Result<Document>> {
    const pathResult = await this.getDocumentPath(key);
    if (!pathResult.success) return pathResult;

    const result = await this.storageRepository.getObject(pathResult.data);
    if (!result.success) return result;

    const document: Document = {
      ...result.data,
      key,
      type: "published",
      status: "published",
    };

    return success(document);
  }

  async createDocument(create: DocumentCreate): Promise<Result<Document>> {
    const pathResult = await this.getDocumentPath(create.key);
    if (!pathResult.success) return pathResult;

    const now = new Date().toISOString();

    const object = await this.storageRepository.createObject({
      type: "object",
      key: pathResult.data,
      content: create.content,
    });

    if (!object.success) return object;

    const document: Document = {
      ...object.data,
      key: create.key,
      type: "published",
      status: "published",
      createdAt: now,
      updatedAt: now,
    };

    return success(document);
  }

  async updateDocument(update: DocumentUpdate): Promise<Result<Document>> {
    const pathResult = await this.getDocumentPath(update.key);
    if (!pathResult.success) return pathResult;

    // Get existing document to preserve createdAt
    const existingResult = await this.getDocument(update.key);
    if (!existingResult.success) return existingResult;

    const existing = existingResult.data;
    const newContent = update.content ?? existing.content;

    const result = await this.storageRepository.updateObject({
      key: pathResult.data,
      content: newContent,
    });
    if (!result.success) return result;

    const document: Document = {
      ...existing,
      content: newContent,
      updatedAt: new Date().toISOString(),
    };

    return success(document);
  }

  async deleteDocument(key: string): Promise<Result<void>> {
    // Get paths
    const documentPath = await this.getDocumentPath(key);
    if (!documentPath.success) return documentPath;

    // Permanently delete the document
    const removeResult = await this.storageRepository.removeAtoms([documentPath.data]);
    for await (const result of removeResult) {
      if (!result.success) return result;
    }

    return success(undefined);
  }

  // ===== UNPUBLISHED =====

  async getUnpublished(key: string): Promise<Result<Unpublished>> {
    const settings = await this.settingsProvider.getDocumentCollectionSettings(this.collection);
    if (!settings.success) return settings;

    const unpublishedStatuses = settings.data.unpublishedStatuses || {};

    // Try each status directory to find the unpublished document
    for (const [status, statusConfig] of Object.entries(unpublishedStatuses)) {
      const basePath = `.contentbase/${this.collection}/${statusConfig.directory}`;
      const fullPath = pathCombine(basePath, key);

      const result = await this.storageRepository.getObject(fullPath);
      if (result.success) {
        const unpublished: Unpublished = {
          ...result.data,
          key,
          type: "unpublished",
          status,
        };
        return success(unpublished);
      }
    }

    return failure(NotFoundError.CODE, [`Unpublished document '${key}' not found in collection '${this.collection}'`]);
  }

  async createUnpublished(create: UnpublishedCreate): Promise<Result<Unpublished>> {
    const pathResult = await this.getUnpublishedPath(create.key, create.status);
    if (!pathResult.success) return pathResult;

    const now = new Date().toISOString();

    const object = await this.storageRepository.createObject({
      type: "object",
      key: pathResult.data,
      content: create.content,
    });

    if (!object.success) return object;

    const unpublished: Unpublished = {
      ...object.data,
      key: create.key,
      type: "unpublished",
      status: create.status,
      createdAt: now,
      updatedAt: now,
    };

    return success(unpublished);
  }

  async updateUnpublished(update: UnpublishedUpdate): Promise<Result<Unpublished>> {
    // Get the existing unpublished document
    const existingResult = await this.getUnpublished(update.key);
    if (!existingResult.success) return existingResult;

    const existing = existingResult.data;
    const newStatus = update.status || existing.status;
    const newContent = update.content || existing.content;

    // If status is changing, we need to move the file
    if (update.status && update.status !== existing.status) {
      return this.updateUnpublishedStatus(update.key, update.status);
    }

    // Just update content in place
    const pathResult = await this.getUnpublishedPath(update.key, existing.status);
    if (!pathResult.success) return pathResult;

    const result = await this.storageRepository.updateObject({
      key: pathResult.data,
      content: newContent,
    });
    if (!result.success) return result;

    const unpublished: Unpublished = {
      ...existing,
      content: newContent,
      updatedAt: new Date().toISOString(),
    };

    return success(unpublished);
  }

  /**
   * Update the status of an unpublished document (moves it to a different directory)
   */
  private async updateUnpublishedStatus(key: string, newStatus: string): Promise<Result<Unpublished>> {
    // Get the existing unpublished document
    const existingResult = await this.getUnpublished(key);
    if (!existingResult.success) return existingResult;

    const existing = existingResult.data;

    // Get paths
    const oldPath = await this.getUnpublishedPath(key, existing.status);
    if (!oldPath.success) return oldPath;

    const newPath = await this.getUnpublishedPath(key, newStatus);
    if (!newPath.success) return newPath;

    const now = new Date().toISOString();

    // Create in new location
    const createResult = await this.storageRepository.createObject({
      type: "object",
      key: newPath.data,
      content: existing.content,
    });
    if (!createResult.success) return createResult;

    // Remove from old location
    const removeResult = await this.storageRepository.removeAtoms([oldPath.data]);
    for await (const result of removeResult) {
      if (!result.success) return result;
    }

    const unpublished: Unpublished = {
      ...existing,
      status: newStatus,
      updatedAt: now,
    };

    return success(unpublished);
  }

  async deleteUnpublished(key: string): Promise<Result<void>> {
    // Get the existing unpublished document to find its status
    const existingResult = await this.getUnpublished(key);
    if (!existingResult.success) return existingResult;

    const pathResult = await this.getUnpublishedPath(key, existingResult.data.status);
    if (!pathResult.success) return pathResult;

    const removeResult = await this.storageRepository.removeAtoms([pathResult.data]);
    for await (const result of removeResult) {
      if (!result.success) return result;
    }

    return success(undefined);
  }

  async unpublish(key: string, status: string): Promise<Result<Unpublished>> {
    // Get the document
    const documentResult = await this.getDocument(key);
    if (!documentResult.success) return documentResult;

    const document = documentResult.data;

    // Get paths
    const documentPath = await this.getDocumentPath(key);
    if (!documentPath.success) return documentPath;

    const unpublishedPath = await this.getUnpublishedPath(key, status);
    if (!unpublishedPath.success) return unpublishedPath;

    const now = new Date().toISOString();

    // Write to unpublished location  
    const createResult = await this.storageRepository.createObject({
      type: "object",
      key: unpublishedPath.data,
      content: document.content,
    });
    if (!createResult.success) return createResult;

    // Remove from documents
    const removeResult = await this.storageRepository.removeAtoms([documentPath.data]);
    for await (const result of removeResult) {
      if (!result.success) return result;
    }

    const unpublished: Unpublished = {
      key,
      type: "unpublished",
      status,
      content: document.content,
      createdAt: document.createdAt,
      updatedAt: now,
    };

    return success(unpublished);
  }

  async publish(key: string): Promise<Result<Document>> {
    // Get the unpublished document
    const unpublishedResult = await this.getUnpublished(key);
    if (!unpublishedResult.success) return unpublishedResult;

    const unpublished = unpublishedResult.data;

    // Get paths
    const unpublishedPath = await this.getUnpublishedPath(key, unpublished.status);
    if (!unpublishedPath.success) return unpublishedPath;

    const documentPath = await this.getDocumentPath(key);
    if (!documentPath.success) return documentPath;

    const now = new Date().toISOString();

    // Write to documents
    const createResult = await this.storageRepository.createObject({
      type: "object",
      key: documentPath.data,
      content: unpublished.content,
    });
    if (!createResult.success) return createResult;

    // Remove from unpublished
    const removeResult = await this.storageRepository.removeAtoms([unpublishedPath.data]);
    for await (const result of removeResult) {
      if (!result.success) return result;
    }

    const document: Document = {
      key,
      type: "published",
      status: "published",
      content: unpublished.content,
      createdAt: unpublished.createdAt,
      updatedAt: now,
    };

    return success(document);
  }

  // ===== RECORDS (LIST ALL TYPES) =====

  /**
   * Private helper to list records with configurable output type
   */
  private async *listRecordsInternal<T extends 'full' | 'summary'>(
    options: ListRecordsOptions,
    mode: T
  ): AsyncGenerator<Result<readonly (T extends 'full' ? Record : RecordSummary)[]>> {
    const settings = await this.settingsProvider.getDocumentCollectionSettings(this.collection);
    if (!settings.success) {
      yield settings as any;
      return;
    }

    // Choose the appropriate storage method based on mode
    const listMethod = mode === 'full'
      ? this.storageRepository.listAtoms.bind(this.storageRepository)
      : this.storageRepository.listAtomSummaries.bind(this.storageRepository);

    // List documents if requested
    if (options.type === 'published' || options.type === undefined) {
      const directory = settings.data.directory;
      const folderPath = options.folder ? pathCombine(directory, options.folder) : directory;

      for await (const atoms of listMethod(folderPath, {
        pagination: options.pagination,
        depth: options.depth,
      })) {
        if (!atoms.success) {
          yield atoms as any;
          continue;
        }

        const items = atoms.data
          .filter(atom => atom.type === 'object-summary' || atom.type === 'object')
          .map(atom => {
            const key = this.extractKeyFromPath(atom.key, directory);
            return {
              ...atom,
              key,
              type: (mode === 'full' ? 'published' : 'published-summary') as any,
              status: 'published' as const,
            };
          });

        yield success(items) as any;
      }
    }

    // List unpublished if requested
    if (options.type === 'unpublished' || options.type === undefined) {
      const unpublishedStatuses = settings.data.unpublishedStatuses || {};
      const statusesToList = options.statuses || Object.keys(unpublishedStatuses);

      for (const status of statusesToList) {
        const statusConfig = unpublishedStatuses[status];
        if (!statusConfig) continue;

        const basePath = `.contentbase/${this.collection}/${statusConfig.directory}`;
        const folderPath = options.folder ? pathCombine(basePath, options.folder) : basePath;

        for await (const atoms of listMethod(folderPath, {
          pagination: options.pagination,
          depth: options.depth,
        })) {
          if (!atoms.success) {
            // Ignore not found errors for unpublished directories that don't exist yet
            if (atoms.code === NotFoundError.CODE) continue;
            yield atoms as any;
            continue;
          }

          const items = atoms.data
            .filter(atom => atom.type === 'object-summary' || atom.type === 'object')
            .map(atom => {
              const key = this.extractKeyFromPath(atom.key, basePath);
              return {
                ...atom,
                key,
                type: (mode === 'full' ? 'unpublished' : 'unpublished-summary') as any,
                status,
              };
            });

          yield success(items) as any;
        }
      }
    }
  }

  /**
   * List full record objects with content
   */
  async *listRecords(options: ListRecordsOptions): AsyncGenerator<Result<readonly Record[]>> {
    yield* this.listRecordsInternal(options, 'full');
  }

  /**
   * List record summaries (without content) for efficient listing
   */
  async *listRecordSummaries(options: ListRecordSummaries): AsyncGenerator<Result<readonly RecordSummary[]>> {
    yield* this.listRecordsInternal(options, 'summary');
  }

  // ===== REVISIONS =====

  async getRevision(key: string, revision: string): Promise<Result<Revision>> {
    const pathResult = await this.getRevisionPath(key, revision);
    if (!pathResult.success) return pathResult;

    const result = await this.storageRepository.getObject(pathResult.data);
    if (!result.success) return result;

    if (!result.data.createdAt) {
      return failure(InvalidData.CODE, ["Revision is missing createdAt date"]);
    }

    const revisionEntry: Revision = {
      ...result.data,
      createdAt: result.data.createdAt,
      revision,
      type: "revision",
      key,
    };

    return success(revisionEntry);
  }

  async createRevision(create: RevisionCreate): Promise<Result<Revision>> {
    const pathResult = await this.getRevisionPath(create.key, create.revision);
    if (!pathResult.success) return pathResult;

    const now = new Date().toISOString();

    const object = await this.storageRepository.createObject({
      type: "object",
      key: pathResult.data,
      content: create.content,
    });

    if (!object.success) return object;

    const revision: Revision = {
      ...object.data,
      key: create.key,
      revision: create.revision,
      type: "revision",
      createdAt: now,
      updatedAt: now,
    };

    return success(revision);
  }

  async *listRevisions(key: string, options: ListRevisionsOptions): AsyncGenerator<Result<readonly RevisionSummary[]>> {
    const pathResult = await this.getRevisionPath(key);
    if (!pathResult.success) {
      yield pathResult;
      return;
    }

    const revisionDirectory = pathResult.data;

    const generator = this.storageRepository.listAtomSummaries(revisionDirectory, {
      pagination: options.pagination,
      depth: 1,
    });

    for await (const result of generator) {
      if (!result.success) {
        yield result;
        continue;
      }

      const summaries = result.data
        .filter((atom) => atom.type === "object-summary")
        .map((atom) => {
          const revision = basename(atom.key);
          return {
            ...atom,
            type: "revision-summary" as const,
            revision,
            key,
          } satisfies RevisionSummary;
        });

      yield success(summaries);
    }
  }
}
