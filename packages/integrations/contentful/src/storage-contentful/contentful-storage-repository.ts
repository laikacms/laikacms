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
  naturalCompare,
  StorageRepository,
} from 'laikacms/storage';

import {
  ContentfulDataSource,
  type ContentfulDataSourceOptions,
  type ContentfulEntry,
} from './contentful-datasource.js';

export interface ContentfulStorageRepositoryOptions extends ContentfulDataSourceOptions {
  /**
   * Optional serializer registry — Contentful stores **structured** field
   * values, not strings, so serializers are not used on writes. Still
   * surfaced in `getCapabilities` for callers that introspect it.
   */
  readonly serializerRegistry?: StorageSerializerRegistry;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

/** Split a Contentful storage key into `(contentTypeId, entryId)`. */
const splitKey = (key: string): { contentTypeId: string, entryId: string, tooDeep: boolean } => {
  const trimmed = trimSlashes(key);
  const segments = trimmed.split('/').filter(s => s !== '');
  if (segments.length === 0) return { contentTypeId: '', entryId: '', tooDeep: false };
  if (segments.length === 1) return { contentTypeId: segments[0], entryId: '', tooDeep: false };
  if (segments.length === 2) {
    return { contentTypeId: segments[0], entryId: segments[1], tooDeep: false };
  }
  return { contentTypeId: segments[0], entryId: segments.slice(1).join('/'), tooDeep: true };
};

/**
 * A {@link StorageRepository} backed by Contentful via the Content Management
 * API.
 *
 * The mapping is deliberately straightforward — Contentful's data model
 * matches a two-level filesystem exactly:
 *
 *     <contentTypeId>/<entryId>     a Contentful entry — an "object"
 *     <contentTypeId>               a Contentful content type — a "folder"
 *     <root>                        the environment — implicitly a folder of folders
 *
 * Storage keys deeper than two segments are rejected because Contentful's
 * data model has no nested entries. Object content is the entry's `fields`
 * flattened to the configured `defaultLocale` — there is no serializer step
 * because Contentful stores structured values, not strings.
 *
 * Contentful's `sys.version` counter drives **real optimistic concurrency** —
 * surfaced as `metadata.revisionId`, round-tripped on `updateObject` and
 * `removeAtoms` so concurrent edits return `VersionMismatchError` instead
 * of silently overwriting.
 */
export class ContentfulStorageRepository extends StorageRepository {
  private readonly dataSource: ContentfulDataSource;
  private readonly defaultLocale: string;
  private readonly serializerRegistry: StorageSerializerRegistry;

  constructor(options: ContentfulStorageRepositoryOptions) {
    super();
    this.dataSource = new ContentfulDataSource(options);
    this.defaultLocale = this.dataSource.defaultLocale;
    this.serializerRegistry = options.serializerRegistry ?? {};
  }

  // -----------------------------------------------------------------------
  // Field <-> content conversion
  // -----------------------------------------------------------------------

  /** Flatten a Contentful `fields` object to a plain content object under the configured locale. */
  private fieldsToContent(fields: ContentfulEntry['fields']): StorageObjectContent {
    const out: Record<string, unknown> = {};
    for (const [fieldId, byLocale] of Object.entries(fields)) {
      if (this.defaultLocale in byLocale) {
        out[fieldId] = byLocale[this.defaultLocale];
        continue;
      }
      // Fall back to the first available locale so reads don't drop content
      // silently when the configured locale isn't populated for a field.
      const first = Object.values(byLocale)[0];
      if (first !== undefined) out[fieldId] = first;
    }
    return out;
  }

  /** Inverse of {@link fieldsToContent} — wrap each value under the configured locale. */
  private contentToFields(content: StorageObjectContent): ContentfulEntry['fields'] {
    const out: ContentfulEntry['fields'] = {};
    for (const [key, value] of Object.entries(content)) {
      out[key] = { [this.defaultLocale]: value };
    }
    return out;
  }

  private toStorageObject(entry: ContentfulEntry): StorageObject {
    return {
      type: 'object',
      key: `${entry.sys.contentType.sys.id}/${entry.sys.id}`,
      createdAt: entry.sys.createdAt,
      updatedAt: entry.sys.updatedAt,
      content: this.fieldsToContent(entry.fields),
      metadata: { revisionId: String(entry.sys.version) },
    };
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { contentTypeId, entryId, tooDeep } = splitKey(key);
        if (tooDeep || contentTypeId === '' || entryId === '') {
          return yield* Effect.fail(
            new BadRequestError(`Contentful object keys must be "<contentType>/<entryId>"; got "${key}"`),
          );
        }
        const entry = yield* liftResult(this.dataSource.getEntry(entryId));
        if (!entry) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        if (entry.sys.contentType.sys.id !== contentTypeId) {
          return yield* Effect.fail(
            new NotFoundError(
              `Entry "${entryId}" belongs to content type "${entry.sys.contentType.sys.id}", not "${contentTypeId}"`,
            ),
          );
        }
        return this.toStorageObject(entry);
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') {
          // The root "folder of content types" — always exists.
          return { type: 'folder', key: '' } satisfies Folder;
        }
        if (trimmed.includes('/')) {
          return yield* Effect.fail(
            new BadRequestError(`Contentful folder keys must be a single segment; got "${key}"`),
          );
        }
        const ct = yield* liftResult(this.dataSource.getContentType(trimmed));
        if (!ct) {
          return yield* Effect.fail(new NotFoundError(`No content type found for "${key}"`));
        }
        return {
          type: 'folder',
          key: trimmed,
          createdAt: ct.sys.createdAt,
          updatedAt: ct.sys.updatedAt,
        } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '' || !trimmed.includes('/')) {
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
        const { contentTypeId, entryId, tooDeep } = splitKey(create.key);
        if (tooDeep || contentTypeId === '' || entryId === '') {
          return yield* Effect.fail(
            new BadRequestError(`Contentful keys must be "<contentType>/<entryId>"; got "${create.key}"`),
          );
        }

        // Confirm the content type exists. Without this, Contentful returns a
        // 422 that's less obvious than a NotFoundError on the folder.
        const ct = yield* liftResult(this.dataSource.getContentType(contentTypeId));
        if (!ct) {
          return yield* Effect.fail(
            new NotFoundError(`Content type "${contentTypeId}" does not exist — call createFolder first`),
          );
        }

        // Pre-flight duplicate check so the duplicate-create error message is friendlier.
        const existing = yield* liftResult(this.dataSource.getEntry(entryId));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(`An entry with id "${entryId}" already exists`),
          );
        }

        const fields = this.contentToFields(create.content);
        const entry = yield* liftResult(this.dataSource.createEntry(entryId, contentTypeId, fields));
        return this.toStorageObject(entry);
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { contentTypeId, entryId, tooDeep } = splitKey(update.key);
        if (tooDeep || contentTypeId === '' || entryId === '') {
          return yield* Effect.fail(
            new BadRequestError(`Contentful keys must be "<contentType>/<entryId>"; got "${update.key}"`),
          );
        }
        const existing = yield* liftResult(this.dataSource.getEntry(entryId));
        if (!existing || existing.sys.contentType.sys.id !== contentTypeId) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }

        if (!update.content) return this.toStorageObject(existing);

        // If the caller passed back a revisionId, enforce it — otherwise use the
        // version we just fetched (last-writer-wins from this client's perspective).
        const expectedVersion = update.metadata?.revisionId
          ? Number(update.metadata.revisionId)
          : existing.sys.version;
        const merged: ContentfulEntry['fields'] = { ...existing.fields, ...this.contentToFields(update.content) };
        const updated = yield* liftResult(this.dataSource.updateEntry(entryId, expectedVersion, merged));
        return this.toStorageObject(updated);
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const { contentTypeId, entryId, tooDeep } = splitKey(create.key);
        if (tooDeep || contentTypeId === '' || entryId === '') {
          return yield* Effect.fail(
            new BadRequestError(`Contentful keys must be "<contentType>/<entryId>"; got "${create.key}"`),
          );
        }
        // Ensure the content type exists — idempotent.
        yield* liftResult(this.dataSource.ensureContentType(contentTypeId));

        const fields = create.content ? this.contentToFields(create.content) : {};
        const existing = yield* liftResult(this.dataSource.getEntry(entryId));
        if (!existing) {
          const created = yield* liftResult(this.dataSource.createEntry(entryId, contentTypeId, fields));
          return this.toStorageObject(created);
        }
        const merged: ContentfulEntry['fields'] = { ...existing.fields, ...fields };
        const updated = yield* liftResult(this.dataSource.updateEntry(entryId, existing.sys.version, merged));
        return this.toStorageObject(updated);
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(folderCreate.key);
        if (trimmed === '' || trimmed.includes('/')) {
          return yield* Effect.fail(
            new BadRequestError(
              `Contentful folder keys must be a single content-type id; got "${folderCreate.key}"`,
            ),
          );
        }
        yield* liftResult(this.dataSource.ensureContentType(trimmed));
        return yield* LaikaTask.runValue(this.getFolder(trimmed));
      })
    );
  }

  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        let removed = 0;
        let skipped = 0;
        for (const key of keys) {
          const { contentTypeId, entryId } = splitKey(key);

          if (entryId === '') {
            // Deleting an entire content type — refuse if it still has entries.
            const ct = yield* Effect.result(liftResult(this.dataSource.getContentType(contentTypeId)));
            if (Result.isFailure(ct)) {
              yield* emit.recoverableError(ct.failure);
              skipped += 1;
              continue;
            }
            if (!ct.success) {
              yield* emit.recoverableError(new NotFoundError(`No folder found at key "${key}"`));
              skipped += 1;
              continue;
            }
            const entries = yield* Effect.result(liftResult(this.dataSource.listEntries(contentTypeId)));
            if (Result.isFailure(entries)) {
              yield* emit.recoverableError(entries.failure);
              skipped += 1;
              continue;
            }
            if (entries.success.length > 0) {
              yield* emit.recoverableError(
                new ForbiddenError(`Refusing to delete non-empty content type "${contentTypeId}"`),
              );
              skipped += 1;
              continue;
            }
            // Deleting a content type is a separate (rare) admin operation —
            // we intentionally don't expose it through removeAtoms.
            yield* emit.recoverableError(
              new ForbiddenError(
                `Deleting content types is an admin operation; do it via the Contentful UI or CMA admin tools`,
              ),
            );
            skipped += 1;
            continue;
          }

          const entry = yield* Effect.result(liftResult(this.dataSource.getEntry(entryId)));
          if (Result.isFailure(entry)) {
            yield* emit.recoverableError(entry.failure);
            skipped += 1;
            continue;
          }
          if (!entry.success || entry.success.sys.contentType.sys.id !== contentTypeId) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          const deleted = yield* Effect.result(
            liftResult(this.dataSource.deleteEntry(entryId, entry.success.sys.version)),
          );
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
      const trimmed = trimSlashes(folderKey);

      // Root: list every content type as a folder.
      if (trimmed === '') {
        const cts = yield* liftResult(this.dataSource.listContentTypes());
        const summaries: AtomSummary[] = cts.map(ct => ({ type: 'folder-summary', key: ct.sys.id }));
        const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
        return { summaries: applyPagination(sorted, options.pagination) };
      }

      if (trimmed.includes('/')) {
        return {
          summaries: [] as ReadonlyArray<AtomSummary>,
          missingFolder: new NotFoundError(
            `Contentful folder keys must be a single content-type id; got "${folderKey}"`,
          ),
        };
      }

      // Single content-type folder: list its entries.
      const ct = yield* liftResult(this.dataSource.getContentType(trimmed));
      if (!ct) {
        return {
          summaries: [] as ReadonlyArray<AtomSummary>,
          missingFolder: new NotFoundError(`No content type found for "${folderKey}"`),
        };
      }
      const entries = yield* liftResult(this.dataSource.listEntries(trimmed));
      const summaries: AtomSummary[] = entries.map(entry => ({
        type: 'object-summary',
        key: `${trimmed}/${entry.sys.id}`,
      }));
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-19'),
      fileExtensions: {
        supported: false,
        description: 'Contentful stores structured field values, not files — extensions are not meaningful.',
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over the CMA `skip`/`limit` pages; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
