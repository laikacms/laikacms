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

import { HygraphDataSource, type HygraphDataSourceOptions } from './hygraph-datasource.js';

export interface HygraphStorageRepositoryOptions extends HygraphDataSourceOptions {
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly determineExtension?: DetermineExtension;
}

const liftResult = <A>(promise: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => promise), Effect.fromResult);

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, '');

const splitKey = (key: string): { parent: string, name: string } => {
  const k = trimSlashes(key);
  const idx = k.lastIndexOf('/');
  return idx === -1 ? { parent: '', name: k } : { parent: k.slice(0, idx), name: k.slice(idx + 1) };
};

interface FileNode {
  id: string;
  parent: string;
  name: string;
  path: string;
  extension: string;
  content: string;
  updatedAt?: string;
  createdAt?: string;
}

interface FolderNode {
  id: string;
  parent: string;
  name: string;
  path: string;
  updatedAt?: string;
  createdAt?: string;
}

// -----------------------------------------------------------------------
// GraphQL fragments — kept as constants so the test mock can dispatch by
// operationName, and so the diff between operations is easy to read.
// -----------------------------------------------------------------------

const FILE_FIELDS = `id parent name path extension content createdAt updatedAt`;
const FOLDER_FIELDS = `id parent name path createdAt updatedAt`;

const FIND_FILE_QUERY = `
  query FindLaikaObject($parent: String!, $names: [String!]!, $stage: Stage!) {
    laikaObjects(where: { parent: $parent, name_in: $names }, first: 1, stage: $stage) {
      ${FILE_FIELDS}
    }
  }
`;

const GET_FOLDER_QUERY = `
  query GetLaikaFolder($path: String!, $stage: Stage!) {
    laikaFolders(where: { path: $path }, first: 1, stage: $stage) {
      ${FOLDER_FIELDS}
    }
  }
`;

const LIST_CHILDREN_QUERY = `
  query ListLaikaChildren($parent: String!, $stage: Stage!) {
    laikaObjects(where: { parent: $parent }, stage: $stage) { ${FILE_FIELDS} }
    laikaFolders(where: { parent: $parent }, stage: $stage) { ${FOLDER_FIELDS} }
  }
`;

const CREATE_FILE_MUTATION = `
  mutation CreateLaikaObject($data: LaikaObjectCreateInput!) {
    createLaikaObject(data: $data) { ${FILE_FIELDS} }
  }
`;

const UPDATE_FILE_MUTATION = `
  mutation UpdateLaikaObject($id: ID!, $data: LaikaObjectUpdateInput!) {
    updateLaikaObject(where: { id: $id }, data: $data) { ${FILE_FIELDS} }
  }
`;

const DELETE_FILE_MUTATION = `
  mutation DeleteLaikaObject($id: ID!) {
    deleteLaikaObject(where: { id: $id }) { id }
  }
`;

const CREATE_FOLDER_MUTATION = `
  mutation CreateLaikaFolder($data: LaikaFolderCreateInput!) {
    createLaikaFolder(data: $data) { ${FOLDER_FIELDS} }
  }
`;

const DELETE_FOLDER_MUTATION = `
  mutation DeleteLaikaFolder($id: ID!) {
    deleteLaikaFolder(where: { id: $id }) { id }
  }
`;

const FIND_FOLDER_BY_PARENT_NAME_QUERY = `
  query FindLaikaFolderByParentName($parent: String!, $name: String!, $stage: Stage!) {
    laikaFolders(where: { parent: $parent, name: $name }, first: 1, stage: $stage) {
      ${FOLDER_FIELDS}
    }
  }
`;

/**
 * A {@link StorageRepository} backed by Hygraph (formerly GraphCMS) via the
 * GraphQL Content API. The first **true-GraphQL** transport in the suite —
 * Sanity (iter 17) uses GROQ, not standard GraphQL.
 *
 * Schema requirements (provision via Hygraph Studio):
 *
 *     model LaikaObject {
 *       parent     String
 *       name       String
 *       path       String
 *       extension  String
 *       content    String   // long-text / multi-line
 *     }
 *
 *     model LaikaFolder {
 *       parent  String
 *       name    String
 *       path    String
 *     }
 *
 * The repository defaults to operating on Hygraph's `DRAFT` stage so writes
 * don't immediately publish. If you want auto-publish semantics, set
 * `stage: 'PUBLISHED'` and write a sibling `publish<Object|Folder>`
 * mutation pass — out of scope here, intentionally.
 *
 * **Listing a folder is one GraphQL operation** that asks for both child
 * files and child folders in a single round-trip — the schema's two
 * top-level fields are queried in parallel inside the same request.
 *
 * Runtime-agnostic — only depends on `fetch`. Caller owns PAT refresh via
 * `auth.tokenProvider`.
 */
export class HygraphStorageRepository extends StorageRepository {
  private readonly dataSource: HygraphDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: HygraphStorageRepositoryOptions) {
    super();
    this.dataSource = new HygraphDataSource(options);
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

  private get stage() {
    return this.dataSource.stage;
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

  /** Find an extension-free file with one GraphQL query (`name_in: [...]`). */
  private async findExistingFile(key: string): Promise<LaikaResult<FileNode | null>> {
    const { parent, name } = splitKey(key);
    if (name === '') return Result.succeed(null);
    const names = this.availableExtensions.map(ext => `${name}.${ext}`);
    const result = await this.dataSource.graphql<{ laikaObjects: FileNode[] }>(
      FIND_FILE_QUERY,
      { parent, names, stage: this.stage },
      'FindLaikaObject',
    );
    if (Result.isFailure(result)) return Result.fail(result.failure);
    const hit = result.success.laikaObjects[0];
    if (!hit) return Result.succeed(null);
    if (!this.availableExtensions.includes(hit.extension)) return Result.succeed(null);
    return Result.succeed(hit);
  }

  /**
   * Ensure folder records exist for every ancestor of `folderKey`. Walks
   * top-down, fetching by `(parent, name)` and creating any missing rung —
   * idempotent so retries are safe.
   */
  private async ensureFolderChain(folderKey: string): Promise<LaikaResult<void>> {
    const trimmed = trimSlashes(folderKey);
    if (trimmed === '') return Result.succeed(undefined);
    const segments = trimmed.split('/');
    for (let i = 0; i < segments.length; i++) {
      const ancestorParent = segments.slice(0, i).join('/');
      const ancestorName = segments[i];
      const ancestorPath = segments.slice(0, i + 1).join('/');
      const existing = await this.dataSource.graphql<{ laikaFolders: FolderNode[] }>(
        FIND_FOLDER_BY_PARENT_NAME_QUERY,
        { parent: ancestorParent, name: ancestorName, stage: this.stage },
        'FindLaikaFolderByParentName',
      );
      if (Result.isFailure(existing)) return Result.fail(existing.failure);
      if (existing.success.laikaFolders.length > 0) continue;
      const created = await this.dataSource.graphql<{ createLaikaFolder: FolderNode }>(
        CREATE_FOLDER_MUTATION,
        { data: { parent: ancestorParent, name: ancestorName, path: ancestorPath } },
        'CreateLaikaFolder',
      );
      if (Result.isFailure(created)) return Result.fail(created.failure);
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
        const content = yield* Effect.promise(() => this.deserialize(found.extension, found.content));
        return {
          type: 'object',
          key: trimSlashes(key),
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
          content,
          metadata: { extension: found.extension, revisionId: found.updatedAt },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const trimmed = trimSlashes(key);
        if (trimmed === '') return { type: 'folder', key: '' } satisfies Folder;
        const result = yield* liftResult(this.dataSource.graphql<{ laikaFolders: FolderNode[] }>(
          GET_FOLDER_QUERY,
          { path: trimmed, stage: this.stage },
          'GetLaikaFolder',
        ));
        const folder = result.laikaFolders[0];
        if (!folder) return yield* Effect.fail(new NotFoundError(`No folder found at key "${key}"`));
        return {
          type: 'folder',
          key: trimmed,
          createdAt: folder.createdAt,
          updatedAt: folder.updatedAt,
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
        const folderResult = yield* Effect.result(liftResult(this.dataSource.graphql<{ laikaFolders: FolderNode[] }>(
          GET_FOLDER_QUERY,
          { path: trimmed, stage: this.stage },
          'GetLaikaFolder',
        )));
        if (Result.isSuccess(folderResult) && folderResult.success.laikaFolders.length > 0) {
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
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${existing.extension}`,
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

        yield* liftResult(this.dataSource.graphql(
          CREATE_FILE_MUTATION,
          {
            data: {
              parent,
              name: `${name}.${extension}`,
              path: trimSlashes(create.key),
              extension,
              content: serialized,
            },
          },
          'CreateLaikaObject',
        ));
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
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          yield* liftResult(this.dataSource.graphql(
            UPDATE_FILE_MUTATION,
            { id: existing.id, data: { content: serialized } },
            'UpdateLaikaObject',
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
          const folderQuery = yield* Effect.result(liftResult(this.dataSource.graphql<{ laikaFolders: FolderNode[] }>(
            GET_FOLDER_QUERY,
            { path: trimmed, stage: this.stage },
            'GetLaikaFolder',
          )));
          if (Result.isFailure(folderQuery)) {
            yield* emit.recoverableError(folderQuery.failure);
            skipped += 1;
            continue;
          }
          const folder = folderQuery.success.laikaFolders[0];
          if (folder) {
            const children = yield* Effect.result(
              liftResult(this.dataSource.graphql<{ laikaObjects: FileNode[], laikaFolders: FolderNode[] }>(
                LIST_CHILDREN_QUERY,
                { parent: trimmed, stage: this.stage },
                'ListLaikaChildren',
              )),
            );
            if (Result.isFailure(children)) {
              yield* emit.recoverableError(children.failure);
              skipped += 1;
              continue;
            }
            if (children.success.laikaObjects.length > 0 || children.success.laikaFolders.length > 0) {
              yield* emit.recoverableError(new ForbiddenError(`Refusing to delete non-empty folder "${key}"`));
              skipped += 1;
              continue;
            }
            const deleted = yield* Effect.result(liftResult(this.dataSource.graphql(
              DELETE_FOLDER_MUTATION,
              { id: folder.id },
              'DeleteLaikaFolder',
            )));
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
          const deleted = yield* Effect.result(liftResult(this.dataSource.graphql(
            DELETE_FILE_MUTATION,
            { id: file.success.id },
            'DeleteLaikaObject',
          )));
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
    { summaries: ReadonlyArray<AtomSummary>, missingFolder?: LaikaError },
    LaikaError
  > {
    return Effect.gen({ self: this }, function*() {
      const trimmed = trimSlashes(folderKey);

      if (trimmed !== '') {
        const folder = yield* liftResult(this.dataSource.graphql<{ laikaFolders: FolderNode[] }>(
          GET_FOLDER_QUERY,
          { path: trimmed, stage: this.stage },
          'GetLaikaFolder',
        ));
        if (folder.laikaFolders.length === 0) {
          return {
            summaries: [] as ReadonlyArray<AtomSummary>,
            missingFolder: new NotFoundError(`No folder found at key "${folderKey}"`),
          };
        }
      }

      // **One** GraphQL operation for both child files and child folders.
      const children = yield* liftResult(this.dataSource.graphql<{
        laikaObjects: FileNode[],
        laikaFolders: FolderNode[],
      }>(
        LIST_CHILDREN_QUERY,
        { parent: trimmed, stage: this.stage },
        'ListLaikaChildren',
      ));

      const summaries: AtomSummary[] = [];
      for (const folder of children.laikaFolders) {
        summaries.push({
          type: 'folder-summary',
          key: trimmed === '' ? folder.name : `${trimmed}/${folder.name}`,
        });
      }
      for (const file of children.laikaObjects) {
        const fullKey = trimmed === '' ? file.name : `${trimmed}/${file.name}`;
        const ext = file.extension;
        const bareKey = ext && fullKey.endsWith(`.${ext}`)
          ? fullKey.slice(0, -(ext.length + 1))
          : fullKey;
        summaries.push({ type: 'object-summary', key: bareKey });
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
        description: 'Stores each object as a LaikaObject GraphQL entity with `content` as a string field.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over GraphQL list queries; cursor pagination is not exposed.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
