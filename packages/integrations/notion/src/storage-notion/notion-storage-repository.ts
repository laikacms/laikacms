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
  type NotionBlock,
  NotionDataSource,
  type NotionDataSourceOptions,
  type NotionPageSummary,
} from './notion-datasource.js';

export interface NotionStorageRepositoryOptions extends NotionDataSourceOptions {
  /**
   * Notion page id that acts as the storage root. All operations are scoped
   * under this page; pages above it are invisible.
   */
  readonly rootPageId: string;
  /**
   * Optional serializer registry — present only for capability advertisement.
   * Notion stores plain text in paragraph blocks; serializers don't run.
   */
  readonly serializerRegistry?: StorageSerializerRegistry;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string, name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

/** Render paragraph blocks into a `\n`-joined body string. */
const blocksToBody = (blocks: ReadonlyArray<NotionBlock>): string => {
  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.type !== 'paragraph') continue;
    const text = (block.paragraph?.rich_text ?? []).map(rt => rt.plain_text).join('');
    paragraphs.push(text);
  }
  return paragraphs.join('\n');
};

/** Does a block list contain any `child_page` blocks? Used to discriminate folders. */
const hasChildPages = (blocks: ReadonlyArray<NotionBlock>): boolean =>
  blocks.some(b => b.type === 'child_page' && !b.archived);

/**
 * A {@link StorageRepository} backed by a Notion workspace via the public API.
 *
 * **Page hierarchy as storage hierarchy.** A storage key like `notes/hello`
 * resolves to a Notion page reached by walking title-by-title under a
 * configured `rootPageId`. Path → page-id resolution is cached
 * per-repository-instance so repeat reads under the same folder don't pay
 * for the walk twice — same pattern as `@laikacms/google/storage-drive`.
 *
 * **Pages with child pages are folders; leaf pages are objects.** The object
 * body is the rendered text of the page's paragraph blocks (everything
 * non-`child_page`), joined by `\n`. On write, the page's body paragraphs
 * are replaced by a single fresh paragraph holding `content.body`.
 *
 * Trade-offs (made explicit in the README):
 *
 * - **Empty folders aren't visible.** Notion doesn't expose a "folder vs page"
 *   marker, so a page with no `child_page` blocks looks identical to a leaf
 *   object. `createFolder('x')` succeeds, but `listAtomSummaries('')`
 *   surfaces `x` as an `object-summary` until you put something in it.
 * - **Plain-text body only.** Rich-text formatting, headings, lists, embeds
 *   are lossy. Use a Notion-aware adapter on top if you need fidelity.
 * - **No native version counter.** Notion's `last_edited_time` is a
 *   timestamp, not a monotonic version — OCC isn't exposed.
 *
 * Runtime-agnostic — only depends on `fetch`. Caller owns OAuth refresh via
 * `auth.tokenProvider`.
 */
export class NotionStorageRepository extends StorageRepository {
  private readonly dataSource: NotionDataSource;
  private readonly rootPageId: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly pathCache = new Map<string, string>();

  constructor(options: NotionStorageRepositoryOptions) {
    super();
    this.dataSource = new NotionDataSource(options);
    this.rootPageId = options.rootPageId;
    this.serializerRegistry = options.serializerRegistry ?? {};
  }

  /** Resolve a slash-separated key to a Notion page id by walking titles. */
  private async resolvePath(key: string): Promise<LaikaResult<string | null>> {
    const trimmed = trimSlashes(key);
    if (trimmed === '') return Result.succeed(this.rootPageId);
    const cachedId = this.pathCache.get(trimmed);
    if (cachedId) return Result.succeed(cachedId);

    const segments = trimmed.split('/');
    let parentId = this.rootPageId;
    for (let i = 0; i < segments.length; i++) {
      const child = await this.dataSource.findChildByTitle(parentId, segments[i]);
      if (Result.isFailure(child)) return Result.fail(child.failure);
      if (!child.success) return Result.succeed(null);
      parentId = child.success.id;
    }
    this.pathCache.set(trimmed, parentId);
    return Result.succeed(parentId);
  }

  /** Resolve a folder key — same as `resolvePath` but rejects nonexistent paths. */
  private async resolveFolderId(key: string): Promise<LaikaResult<string>> {
    const resolved = await this.resolvePath(key);
    if (Result.isFailure(resolved)) return Result.fail(resolved.failure);
    if (resolved.success === null) {
      return Result.fail(new NotFoundError(`Notion page not found for "${key}"`));
    }
    return Result.succeed(resolved.success);
  }

  // -----------------------------------------------------------------------
  // StorageRepository implementation
  // -----------------------------------------------------------------------

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.resolvePath(key));
        if (resolved === null || resolved === this.rootPageId) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        const blocks = yield* liftResult(this.dataSource.listBlockChildren(resolved));
        const page = yield* liftResult(this.dataSource.getPage(resolved));
        if (!page) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${key}"`));
        }
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: page.createdTime,
          updatedAt: page.lastEditedTime,
          content: { body: blocksToBody(blocks) },
          // `revisionId` carries the page id — Notion has no monotonic version
          // counter, but the page id is stable across reads so callers can use
          // it to disambiguate identical-title leaf pages.
          metadata: { revisionId: resolved },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.resolvePath(key));
        if (resolved === null) {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        if (resolved === this.rootPageId) {
          return { type: 'folder', key: '' } satisfies Folder;
        }
        const page = yield* liftResult(this.dataSource.getPage(resolved));
        if (!page) {
          return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        }
        return {
          type: 'folder',
          key: trimSlashes(key),
          createdAt: page.createdTime,
          updatedAt: page.lastEditedTime,
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
        const resolved = yield* liftResult(this.resolvePath(key));
        if (resolved === null) {
          return yield* Effect.fail(new NotFoundError(`No atom found at key "${key}"`));
        }
        const blocks = yield* liftResult(this.dataSource.listBlockChildren(resolved));
        // A page is a folder if it currently holds child pages.
        if (hasChildPages(blocks)) {
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
        if (name === '') {
          return yield* Effect.fail(new BadRequestError(`Notion object keys cannot be empty`));
        }
        const parentId = yield* liftResult(this.ensureFolderChain(parent));

        const existing = yield* liftResult(this.dataSource.findChildByTitle(parentId, name));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(`An object with key "${create.key}" already exists`),
          );
        }
        const body = String((create.content as { body?: unknown }).body ?? '');
        const created = yield* liftResult(this.dataSource.createChildPage(parentId, name, body));
        this.pathCache.set(trimSlashes(create.key), created.id);
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* liftResult(this.resolvePath(update.key));
        if (resolved === null || resolved === this.rootPageId) {
          return yield* Effect.fail(new NotFoundError(`No object found at key "${update.key}"`));
        }
        if (update.content) {
          const body = String((update.content as { body?: unknown }).body ?? '');
          yield* liftResult(this.dataSource.replacePageBody(resolved, body));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(create.key);
        const existing = yield* liftResult(this.resolvePath(trimmed));
        if (existing && existing !== this.rootPageId) {
          return yield* LaikaTask.runValue(this.updateObject({ key: trimmed, content: create.content }));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  /** Walk a folder chain, creating each intermediate page that doesn't yet exist. */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<string>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(this.rootPageId);
    const segments = trimmed.split('/');
    let parentId = this.rootPageId;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const cacheKey = segments.slice(0, i + 1).join('/');
      const cached = this.pathCache.get(cacheKey);
      if (cached) {
        parentId = cached;
        continue;
      }
      const existing = await this.dataSource.findChildByTitle(parentId, segment);
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success) {
        parentId = existing.success.id;
      } else {
        const created = await this.dataSource.createChildPage(parentId, segment);
        if (Result.isFailure(created)) return Result.fail(created.failure);
        parentId = created.success.id;
      }
      this.pathCache.set(cacheKey, parentId);
    }
    return Result.succeed(parentId);
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
            yield* emit.recoverableError(new ForbiddenError('Refusing to delete the configured root page'));
            skipped += 1;
            continue;
          }
          const resolved = yield* Effect.result(liftResult(this.resolvePath(trimmed)));
          if (Result.isFailure(resolved)) {
            yield* emit.recoverableError(resolved.failure);
            skipped += 1;
            continue;
          }
          if (resolved.success === null) {
            yield* emit.recoverableError(new NotFoundError(`No atom found at key "${key}"`));
            skipped += 1;
            continue;
          }
          // Refuse non-empty folder deletes for parity with every other StorageRepository.
          const blocks = yield* Effect.result(liftResult(this.dataSource.listBlockChildren(resolved.success)));
          if (Result.isFailure(blocks)) {
            yield* emit.recoverableError(blocks.failure);
            skipped += 1;
            continue;
          }
          if (hasChildPages(blocks.success)) {
            yield* emit.recoverableError(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
            skipped += 1;
            continue;
          }
          const archived = yield* Effect.result(liftResult(this.dataSource.archivePage(resolved.success)));
          if (Result.isFailure(archived)) {
            yield* emit.recoverableError(archived.failure);
            skipped += 1;
          } else {
            this.pathCache.delete(trimmed);
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
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const resolved = yield* Effect.result(liftResult(this.resolveFolderId(folderKey)));
      if (Result.isFailure(resolved)) {
        if (resolved.failure instanceof NotFoundError) {
          return { summaries: [] as ReadonlyArray<AtomSummary>, missingFolder: resolved.failure };
        }
        return yield* Effect.fail(resolved.failure);
      }
      const pages = yield* liftResult(this.dataSource.listChildPages(resolved.success));

      // For each direct child page, we need to know if it itself has children
      // so we can classify it as folder-or-object. The child_page block
      // exposes `has_children`, but only via blockChildren of the parent —
      // we already have that data via `listChildPages` which carries it.
      const summaries: AtomSummary[] = pages.map((page: NotionPageSummary): AtomSummary => {
        const summaryKey = folderKey === '' ? page.title : `${trimSlashes(folderKey)}/${page.title}`;
        return {
          type: page.hasChildren ? 'folder-summary' : 'object-summary',
          key: summaryKey,
        };
      });
      const sorted = [...summaries].sort((a, b) => naturalCompare(a.key, b.key));
      return { summaries: applyPagination(sorted, options.pagination) };
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: this.serializerRegistry && Object.keys(this.serializerRegistry).length > 0
        ? {
          supported: true,
          description:
            'Serializers advertised but Notion stores plain-text paragraph blocks — extensions are not used on the wire.',
          supportedExtensions: this.serializerRegistry,
        }
        : {
          supported: false,
          description: 'Notion stores plain-text paragraph blocks — extensions are not meaningful.',
        },
      pagination: {
        supported: true,
        description: 'In-memory slicing over `GET /blocks/{id}/children`; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
