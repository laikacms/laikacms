import * as Effect from 'effect/Effect';

import type { LaikaDone, LaikaError } from 'laikacms/core';
import { BadRequestError, LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import type {
  Document,
  DocumentCreate,
  DocumentsCapabilities,
  DocumentSummary,
  DocumentUpdate,
  ListRecordsDone,
  ListRecordsOptions,
  ListRecordSummaries,
  ListRevisionsDone,
  ListRevisionsOptions,
  Record,
  RecordSummary,
  Revision,
  RevisionCreate,
  RevisionSummary,
  Unpublished,
  UnpublishedCreate,
  UnpublishedSummary,
  UnpublishedUpdate,
} from 'laikacms/documents';
import { DocumentsCompatibilityDate, DocumentsRepository } from 'laikacms/documents';
import type { Key, StorageObject, StorageObjectContent, StorageRepository } from 'laikacms/storage';

/** Run a LaikaStream to completion and collect its data into a flat array. */
const collectStreamData = <A, D extends LaikaDone, R>(
  stream: LaikaStream.LaikaStream<A, D, R>,
): Effect.Effect<ReadonlyArray<A>, LaikaError, R> =>
  Effect.map(LaikaStream.runCollect(stream), r => r.data);

/**
 * Configuration for {@link ObsidianDocumentsRepository}.
 *
 * An Obsidian vault is a flat directory of markdown notes with no built-in
 * editorial workflow. This backend derives the published / unpublished state
 * from a frontmatter property instead of from separate directories, matching
 * the convention used by Obsidian Publish.
 */
export interface ObsidianDocumentsRepositoryOptions {
  /**
   * Frontmatter property that marks a note as published. A note is treated as
   * a published `Document` when this property is strictly `true`; otherwise it
   * is an `Unpublished` draft. Defaults to `'publish'` (the Obsidian Publish
   * convention).
   */
  publishProperty?: string;
  /**
   * Frontmatter property that records the editorial status of an unpublished
   * note (`draft`, `pending_review`, ...). Defaults to `'status'`.
   */
  statusProperty?: string;
  /**
   * Status reported for an unpublished note that has no explicit
   * `statusProperty`. Defaults to `'draft'`.
   */
  defaultStatus?: string;
}

/**
 * A {@link DocumentsRepository} backed by an Obsidian vault.
 *
 * Wraps a {@link StorageRepository} (typically a `FileSystemStorageRepository`
 * pointed at the vault root) and treats each markdown note as a document whose
 * key is its vault-relative path. Published vs. unpublished is read from, and
 * written to, the note's frontmatter — Obsidian itself keeps no draft state and
 * no version history, so the revision methods are unsupported.
 */
export class ObsidianDocumentsRepository extends DocumentsRepository {
  private readonly publishProperty: string;
  private readonly statusProperty: string;
  private readonly defaultStatus: string;

  constructor(
    private readonly storageRepository: StorageRepository,
    options: ObsidianDocumentsRepositoryOptions = {},
  ) {
    super();
    this.publishProperty = options.publishProperty ?? 'publish';
    this.statusProperty = options.statusProperty ?? 'status';
    this.defaultStatus = options.defaultStatus ?? 'draft';
  }

  getCapabilities(): LaikaTask.LaikaTask<DocumentsCapabilities> {
    return LaikaTask.make<DocumentsCapabilities>(() =>
      Effect.gen({ self: this }, function*() {
        const caps = yield* LaikaTask.runValue(this.storageRepository.getCapabilities());
        return {
          compatibilityDate: DocumentsCompatibilityDate.make('2026-05-19'),
          pagination: caps.pagination,
        };
      })
    );
  }

  // ===== Frontmatter <-> entity mapping =====

  /** A note counts as published only when its publish property is strictly `true`. */
  private isPublished(content: StorageObjectContent): boolean {
    return content[this.publishProperty] === true;
  }

  private languageOf(content: StorageObjectContent): string {
    const lang = content.language;
    return typeof lang === 'string' && lang.length > 0 ? lang : 'und';
  }

  private statusOf(content: StorageObjectContent): string {
    const status = content[this.statusProperty];
    return typeof status === 'string' && status.length > 0 ? status : this.defaultStatus;
  }

  /** Copy `content`, persisting the language as frontmatter (omitted when `'und'`). */
  private withLanguage(content: StorageObjectContent, language: string): StorageObjectContent {
    const next = { ...content };
    if (language && language !== 'und') next.language = language;
    else delete next.language;
    return next;
  }

  /** Copy `content`, marking it published and dropping the draft status property. */
  private asPublishedContent(content: StorageObjectContent): StorageObjectContent {
    const next = { ...content };
    next[this.publishProperty] = true;
    delete next[this.statusProperty];
    return next;
  }

  /** Copy `content`, marking it an unpublished draft with the given status. */
  private asUnpublishedContent(content: StorageObjectContent, status: string): StorageObjectContent {
    const next = { ...content };
    next[this.publishProperty] = false;
    next[this.statusProperty] = status;
    return next;
  }

  private toDocument(key: string, obj: StorageObject): Document {
    return {
      key,
      ...(obj.createdAt ? { createdAt: obj.createdAt } : {}),
      ...(obj.updatedAt ? { updatedAt: obj.updatedAt } : {}),
      type: 'published',
      status: 'published',
      language: this.languageOf(obj.content),
      content: obj.content,
    };
  }

  private toUnpublished(key: string, obj: StorageObject): Unpublished {
    return {
      key,
      ...(obj.createdAt ? { createdAt: obj.createdAt } : {}),
      ...(obj.updatedAt ? { updatedAt: obj.updatedAt } : {}),
      type: 'unpublished',
      status: this.statusOf(obj.content),
      language: this.languageOf(obj.content),
      content: obj.content,
    };
  }

  private toDocumentSummary(obj: StorageObject): DocumentSummary {
    return {
      key: obj.key,
      ...(obj.createdAt ? { createdAt: obj.createdAt } : {}),
      ...(obj.updatedAt ? { updatedAt: obj.updatedAt } : {}),
      type: 'published-summary',
      status: 'published',
      language: this.languageOf(obj.content),
    };
  }

  private toUnpublishedSummary(obj: StorageObject): UnpublishedSummary {
    return {
      key: obj.key,
      ...(obj.createdAt ? { createdAt: obj.createdAt } : {}),
      ...(obj.updatedAt ? { updatedAt: obj.updatedAt } : {}),
      type: 'unpublished-summary',
      status: this.statusOf(obj.content),
      language: this.languageOf(obj.content),
    };
  }

  // ===== Documents (published) =====

  getDocument(key: Key): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const obj = yield* LaikaTask.runValue(this.storageRepository.getObject(key));
        if (!this.isPublished(obj.content)) {
          return yield* Effect.fail(
            new NotFoundError(`Note '${key}' exists but is not a published document`),
          );
        }
        return this.toDocument(key, obj);
      })
    );
  }

  createDocument(create: DocumentCreate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const content = this.asPublishedContent(this.withLanguage(create.content, create.language));
        const obj = yield* LaikaTask.runValue(
          this.storageRepository.createObject({ type: 'object', key: create.key, content }),
        );
        return this.toDocument(create.key, obj);
      })
    );
  }

  updateDocument(update: DocumentUpdate): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValue(this.getDocument(update.key));
        const merged = update.content ?? existing.content;
        const content = this.asPublishedContent(
          this.withLanguage(merged, update.language ?? existing.language),
        );
        const obj = yield* LaikaTask.runValue(
          this.storageRepository.updateObject({ key: update.key, content }),
        );
        return this.toDocument(update.key, obj);
      })
    );
  }

  deleteDocument(key: Key): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        // Confirm it is a published note before removing it.
        yield* LaikaTask.runValue(this.getDocument(key));
        yield* collectStreamData(this.storageRepository.removeAtoms([key]));
      })
    );
  }

  unpublish(key: Key, status: string): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const document = yield* LaikaTask.runValue(this.getDocument(key));
        const content = this.asUnpublishedContent(document.content, status);
        const obj = yield* LaikaTask.runValue(
          this.storageRepository.updateObject({ key, content }),
        );
        return this.toUnpublished(key, obj);
      })
    );
  }

  // ===== Unpublished (drafts) =====

  getUnpublished(key: Key): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const obj = yield* LaikaTask.runValue(this.storageRepository.getObject(key));
        if (this.isPublished(obj.content)) {
          return yield* Effect.fail(
            new NotFoundError(`Note '${key}' exists but is published, not an unpublished draft`),
          );
        }
        return this.toUnpublished(key, obj);
      })
    );
  }

  createUnpublished(create: UnpublishedCreate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const content = this.asUnpublishedContent(
          this.withLanguage(create.content, create.language),
          create.status,
        );
        const obj = yield* LaikaTask.runValue(
          this.storageRepository.createObject({ type: 'object', key: create.key, content }),
        );
        return this.toUnpublished(create.key, obj);
      })
    );
  }

  updateUnpublished(update: UnpublishedUpdate): LaikaTask.LaikaTask<Unpublished> {
    return LaikaTask.make<Unpublished>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* LaikaTask.runValue(this.getUnpublished(update.key));
        const merged = update.content ?? existing.content;
        const content = this.asUnpublishedContent(
          this.withLanguage(merged, update.language ?? existing.language),
          update.status ?? existing.status,
        );
        const obj = yield* LaikaTask.runValue(
          this.storageRepository.updateObject({ key: update.key, content }),
        );
        return this.toUnpublished(update.key, obj);
      })
    );
  }

  deleteUnpublished(key: Key): LaikaTask.LaikaTask<void> {
    return LaikaTask.make<void>(() =>
      Effect.gen({ self: this }, function*() {
        // Confirm it is a draft before removing it.
        yield* LaikaTask.runValue(this.getUnpublished(key));
        yield* collectStreamData(this.storageRepository.removeAtoms([key]));
      })
    );
  }

  publish(key: Key): LaikaTask.LaikaTask<Document> {
    return LaikaTask.make<Document>(() =>
      Effect.gen({ self: this }, function*() {
        const unpublished = yield* LaikaTask.runValue(this.getUnpublished(key));
        const content = this.asPublishedContent(unpublished.content);
        const obj = yield* LaikaTask.runValue(
          this.storageRepository.updateObject({ key, content }),
        );
        return this.toDocument(key, obj);
      })
    );
  }

  // ===== Records (list all states) =====

  listRecords(options: ListRecordsOptions): LaikaStream.LaikaStream<Record, ListRecordsDone> {
    return LaikaStream.make<Record, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const atoms = yield* collectStreamData(
          this.storageRepository.listAtoms(options.folder ?? '', {
            pagination: options.pagination,
            depth: options.depth,
          }),
        );
        let total = 0;
        for (const atom of atoms) {
          if (atom.type !== 'object') continue;
          const record = this.classifyRecord(atom, options);
          if (!record) continue;
          yield* emit.data(record);
          total += 1;
        }
        return { total };
      })
    );
  }

  listRecordSummaries(
    options: ListRecordSummaries,
  ): LaikaStream.LaikaStream<RecordSummary, ListRecordsDone> {
    return LaikaStream.make<RecordSummary, ListRecordsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const atoms = yield* collectStreamData(
          this.storageRepository.listAtoms(options.folder ?? '', {
            pagination: options.pagination,
            depth: options.depth,
          }),
        );
        let total = 0;
        for (const atom of atoms) {
          if (atom.type !== 'object') continue;
          const summary = this.classifySummary(atom, options);
          if (!summary) continue;
          yield* emit.data(summary);
          total += 1;
        }
        return { total };
      })
    );
  }

  /**
   * Map a storage object to a `Record`, applying the `type` / `statuses`
   * filters. Returns `undefined` when the object is filtered out.
   *
   * Note: status comes from frontmatter, so listing must read full objects —
   * `listAtomSummaries` cannot tell published notes from drafts.
   */
  private classifyRecord(obj: StorageObject, options: ListRecordsOptions): Record | undefined {
    if (this.isPublished(obj.content)) {
      if (options.type === 'unpublished') return undefined;
      return this.toDocument(obj.key, obj);
    }
    if (options.type === 'published') return undefined;
    const status = this.statusOf(obj.content);
    if (options.statuses && !options.statuses.includes(status)) return undefined;
    return this.toUnpublished(obj.key, obj);
  }

  private classifySummary(
    obj: StorageObject,
    options: ListRecordsOptions,
  ): RecordSummary | undefined {
    if (this.isPublished(obj.content)) {
      if (options.type === 'unpublished') return undefined;
      return this.toDocumentSummary(obj);
    }
    if (options.type === 'published') return undefined;
    const status = this.statusOf(obj.content);
    if (options.statuses && !options.statuses.includes(status)) return undefined;
    return this.toUnpublishedSummary(obj);
  }

  // ===== Revisions (unsupported) =====

  getRevision(_key: Key, _revision: string): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.fail(
      new BadRequestError('The Obsidian backend has no version history; revisions are unsupported'),
    );
  }

  createRevision(_create: RevisionCreate): LaikaTask.LaikaTask<Revision> {
    return LaikaTask.fail(
      new BadRequestError('The Obsidian backend has no version history; revisions are unsupported'),
    );
  }

  listRevisions(
    _key: Key,
    _options: ListRevisionsOptions,
  ): LaikaStream.LaikaStream<RevisionSummary, ListRevisionsDone> {
    return LaikaStream.empty({ total: 0 } satisfies ListRevisionsDone);
  }
}
