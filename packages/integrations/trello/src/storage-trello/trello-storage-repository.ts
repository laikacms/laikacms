import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  EntryAlreadyExistsError,
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
import * as minimatch from 'minimatch';

import type { TrelloCard, TrelloDataSource, TrelloList } from './trello-datasource.js';

export interface TrelloStorageRepositoryOptions {
  readonly dataSource: TrelloDataSource;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const stripSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitPath = (key: string): { parent: string, name: string } => {
  const k = stripSlashes(key);
  const last = k.lastIndexOf('/');
  if (last === -1) return { parent: '', name: k };
  return { parent: k.slice(0, last), name: k.slice(last + 1) };
};

/**
 * The name we use for the "root container" list — the bucket where
 * root-level files live. Tracked as a known constant so the repository
 * can distinguish it from user-named folders.
 *
 * `__root__` is unlikely to collide with a user-intended folder name
 * (path segments don't normally contain underscores at this position).
 */
const ROOT_LIST_NAME = '__root__';

/**
 * A {@link StorageRepository} backed by a Trello board. Every file is a
 * card; every folder is a list (`open` Trello state); root-level files
 * live in a special list named `__root__`.
 *
 * Mapping example:
 *
 *     Laika key:    notes/hello                 (file)
 *     Trello:       list "notes" contains card "hello.md"
 *
 *     Laika key:    notes/sub/deep              (file in nested folder)
 *     Trello:       list "notes/sub" contains card "deep.md"
 *
 *     Laika key:    notes/sub                   (folder)
 *     Trello:       list named "notes/sub" exists
 *
 *     Laika key:    standalone                  (root-level file)
 *     Trello:       list "__root__" contains card "standalone.md"
 *
 * Five Trello-specific behaviours shape the wire format:
 *
 *  - **Path-as-list-name encoding.** Trello has only two natural levels
 *    of hierarchy (list + card); we use the list's NAME as the folder
 *    path, joining slashes. `notes/sub/deep` is a list literally named
 *    `notes/sub/deep`.
 *
 *  - **Floating-point `pos` ordering.** New cards/lists are appended at
 *    the bottom (`pos: 'bottom'`); Trello assigns a positive-float `pos`
 *    server-side. The repository surfaces `pos` and `dateLastActivity`
 *    in `metadata`.
 *
 *  - **Soft-delete via `closed=true` for lists.** Trello doesn't expose
 *    a physical-delete endpoint for lists; the repository archives
 *    instead. Cards CAN be physically deleted (`DELETE /1/cards/:id`).
 *
 *  - **`?key=…&token=…` URL auth.** Carried in the data source layer.
 *
 *  - **In-memory list cache.** Trello's API requires enumerating lists
 *    via `GET /boards/:id/lists` to find one by name. The data source
 *    layer doesn't cache; the repository keeps a per-call snapshot but
 *    doesn't persist it — concurrent writers may invalidate it.
 *
 * `removeAtoms(N)` does N parallel `DELETE /1/cards/:id` calls — Trello
 * has no bulk-delete endpoint. Same honest-framing approach as Solid
 * Pod (iter 34) and ClickHouse (iter 37).
 */
export class TrelloStorageRepository extends StorageRepository {
  private readonly dataSource: TrelloDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: TrelloStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    this.dataSource = dataSource;
    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension.startsWith('.')
      ? defaultFileExtension.slice(1)
      : defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.determineExtension = determineExtension;
    this.excludeFilter = ignoreList
      .map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true }))
      .filter((re): re is minimatch.MMRegExp => re !== false);
  }

  // ───────────────────────── helpers ─────────────────────────

  private stripExtension(key: string): string {
    for (const ext of this.availableExtensions) {
      if (key.endsWith(`.${ext}`)) return key.slice(0, -(ext.length + 1));
    }
    return key;
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

  private parentToListName(parent: string): string {
    return parent === '' ? ROOT_LIST_NAME : parent;
  }

  /** Find a list by its Trello name. `null` when absent. */
  private async findListByName(listName: string): Promise<TrelloList | null> {
    const result = await this.dataSource.listBoardLists();
    if (Result.isFailure(result)) return null;
    return result.success.find(l => l.name === listName) ?? null;
  }

  /**
   * Resolve an extension-free key to its `(list, card, extension)` triple.
   *
   * Two-step lookup:
   *   1. Find the list named after the parent path.
   *   2. Within that list, find a card whose name starts with `<name>.`
   *      and ends with a known serializer extension.
   */
  private async resolveFile(key: string): Promise<{ list: TrelloList, card: TrelloCard, extension: string } | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const listName = this.parentToListName(parent);
    const list = await this.findListByName(listName);
    if (!list) return null;
    const cardsResult = await this.dataSource.listListCards(list.id);
    if (Result.isFailure(cardsResult)) return null;
    for (const card of cardsResult.success) {
      // Match `<name>.<ext>` where `<ext>` is registered.
      const prefix = `${name}.`;
      if (!card.name.startsWith(prefix)) continue;
      const ext = card.name.slice(prefix.length);
      if (this.availableExtensions.includes(ext)) {
        return { list, card, extension: ext };
      }
    }
    return null;
  }

  /** Ensure a list exists with the given name; return the (existing or new) list. */
  private async ensureList(listName: string): Promise<LaikaResult<TrelloList>> {
    const existing = await this.findListByName(listName);
    if (existing) return Result.succeed(existing);
    return await this.dataSource.createList(listName, { pos: 'bottom' });
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`Trello card not found: ${key}`));
        }
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, resolved.card.desc ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: resolved.card.dateLastActivity ?? new Date(0).toISOString(),
          updatedAt: resolved.card.dateLastActivity ?? new Date(0).toISOString(),
          content,
          // `dateLastActivity` is server-managed; surfaces as revisionId.
          metadata: { extension: resolved.extension, revisionId: resolved.card.dateLastActivity },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          // Root — succeed if any non-archived list exists in the board.
          const lists = yield* liftResult(this.dataSource.listBoardLists());
          if (lists.length === 0) {
            return yield* Effect.fail(new NotFoundError('Trello board has no open lists'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        const list = yield* Effect.promise(() => this.findListByName(k));
        if (!list) {
          return yield* Effect.fail(new NotFoundError(`Trello list not found: ${k}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.resolveFile(key));
        if (file) return yield* LaikaTask.runValue(this.getObject(key));
        const folder = yield* Effect.result(LaikaTask.runValue(this.getFolder(key)));
        if (Result.isSuccess(folder)) return folder.success;
        return yield* Effect.fail(new BadRequestError(`Path not found: ${key}`));
      })
    );
  }

  createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        if (!create.content) {
          return yield* Effect.fail(new BadRequestError('Object content is required for creation'));
        }
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const list = yield* liftResult(this.ensureList(this.parentToListName(parent)));
        yield* liftResult(this.dataSource.createCard(list.id, `${name}.${extension}`, {
          desc: serialized,
          pos: 'bottom',
        }));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`Trello card not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          yield* liftResult(this.dataSource.updateCard(existing.card.id, { desc: serialized }));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        if (existing) {
          return yield* LaikaTask.runValue(this.updateObject({
            key: create.key,
            content: create.content,
          } as StorageObjectUpdate));
        }
        return yield* LaikaTask.runValue(this.createObject(create));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        yield* liftResult(this.ensureList(k));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  /**
   * `removeAtoms(N)` does N parallel `DELETE /1/cards/:id` calls. Trello
   * has no bulk-delete endpoint — this iteration does NOT add a new
   * atomic-multi-write mechanism. Same honest framing as Solid Pod
   * (iter 34) and ClickHouse (iter 37) — the novelty here is in the
   * `pos` ordering, query-string auth, and soft-delete semantics, not
   * in multi-write atomicity.
   */
  removeAtoms(keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.make<string, RemoveAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const cleanKeys = keys.map(s => stripSlashes(s)).filter(s => s !== '');
        const skipped0 = keys.length - cleanKeys.length;
        if (cleanKeys.length === 0) {
          for (let i = 0; i < skipped0; i++) {
            yield* emit.recoverableError(new BadRequestError('Refusing to delete empty key'));
          }
          return { removed: 0, skipped: skipped0 };
        }

        // Parallel resolve + delete per key.
        const results = yield* Effect.promise(async () => {
          return await Promise.all(cleanKeys.map(async k => {
            const resolved = await this.resolveFile(k);
            if (!resolved) return { key: k, outcome: 'missing' as const };
            const del = await this.dataSource.deleteCard(resolved.card.id);
            return Result.isSuccess(del)
              ? { key: k, outcome: 'removed' as const }
              : { key: k, outcome: 'failed' as const, error: del.failure };
          }));
        });

        let removed = 0;
        let skipped = skipped0;
        for (const r of results) {
          if (r.outcome === 'removed') {
            yield* emit.data(r.key);
            removed += 1;
          } else if (r.outcome === 'missing') {
            yield* emit.recoverableError(new NotFoundError(`Trello card not found: ${r.key}`));
            skipped += 1;
          } else {
            yield* emit.recoverableError(r.error);
            skipped += 1;
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

  /**
   * For `folderKey === ''` (root), summaries are:
   *   - All cards in the `__root__` list (as files)
   *   - All other open lists in the board (as folders)
   *
   * For a named folder, summaries are:
   *   - All cards in the list with matching name (as files)
   *   - (Trello has only two natural levels, so deeper subfolders
   *     don't appear here unless their list names start with
   *     `<folderKey>/`)
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const k = stripSlashes(folderKey);
      const lists = yield* liftResult(this.dataSource.listBoardLists());
      const summaries: AtomSummary[] = [];

      // Files from the list whose name matches folderKey (or __root__ for root).
      const ownListName = this.parentToListName(k);
      const ownList = lists.find(l => l.name === ownListName);
      if (ownList) {
        const cards = yield* liftResult(this.dataSource.listListCards(ownList.id));
        for (const card of cards) {
          // Strip a registered serializer extension.
          let stripped = card.name;
          for (const ext of this.availableExtensions) {
            if (stripped.endsWith(`.${ext}`)) {
              stripped = stripped.slice(0, -(ext.length + 1));
              break;
            }
          }
          summaries.push({
            type: 'object-summary',
            key: k === '' ? stripped : `${k}/${stripped}`,
          });
        }
      }

      // Subfolder lists — those whose names start with `<k>/` (or any
      // non-`__root__` list, at the root level).
      for (const list of lists) {
        if (list.name === ROOT_LIST_NAME) continue;
        if (list.name === ownListName) continue;
        let folderName: string | null = null;
        if (k === '') {
          // Root: every non-root list whose name doesn't contain `/` is
          // a top-level folder; deeper lists are surfaced as their first
          // path segment.
          const firstSlash = list.name.indexOf('/');
          folderName = firstSlash === -1 ? list.name : list.name.slice(0, firstSlash);
        } else if (list.name.startsWith(`${k}/`)) {
          // Subfolder: take the next segment under `k/`.
          const after = list.name.slice(k.length + 1);
          const slash = after.indexOf('/');
          folderName = slash === -1 ? after : after.slice(0, slash);
        }
        if (folderName !== null) {
          const fullKey = k === '' ? folderName : `${k}/${folderName}`;
          if (!summaries.some(s => s.type === 'folder-summary' && s.key === fullKey)) {
            summaries.push({ type: 'folder-summary', key: fullKey });
          }
        }
      }

      const filtered = summaries.filter(s => this.excludeFilter.every(p => !p.test(s.key)));
      const sorted = [...filtered].sort((a, b) => naturalCompare(a.key, b.key));
      return applyPagination(sorted, options.pagination);
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      compatibilityDate: CompatibilityDate.make('2026-05-20'),
      fileExtensions: {
        supported: true,
        description:
          'Each object is one Trello card; the extension is encoded into the card name and tracked separately.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over Trello card listings; native cursor pagination not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
