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

import { allNodeProps, type CypherStatement, firstNodeProps, type Neo4jDataSource } from './neo4j-datasource.js';

export interface Neo4jStorageRepositoryOptions {
  readonly dataSource: Neo4jDataSource;
  /** Node label for file nodes. Default `LaikaFile`. */
  readonly fileLabel?: string;
  /** Node label for folder nodes. Default `LaikaFolder`. */
  readonly folderLabel?: string;
  /** Relationship type linking a child to its parent. Default `CHILD_OF`. */
  readonly relationshipType?: string;
  readonly serializerRegistry: StorageSerializerRegistry;
  readonly defaultFileExtension: string;
  readonly ignoreList?: readonly string[];
  readonly determineExtension?: DetermineExtension;
}

const DEFAULT_FILE_LABEL = 'LaikaFile';
const DEFAULT_FOLDER_LABEL = 'LaikaFolder';
const DEFAULT_RELATIONSHIP_TYPE = 'CHILD_OF';

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

const validateLabel = (label: string): void => {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(label)) {
    throw new BadRequestError(`Invalid Cypher label (must be PascalCase identifier): ${label}`);
  }
};

const validateRelType = (relType: string): void => {
  if (!/^[A-Z][A-Z0-9_]*$/.test(relType)) {
    throw new BadRequestError(`Invalid Cypher relationship type (must be UPPER_SNAKE_CASE): ${relType}`);
  }
};

interface StoredNode {
  path: string;
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A {@link StorageRepository} backed by Neo4j via the transactional HTTP
 * endpoint. Each Laika atom is a node — files carry the `LaikaFile`
 * label, folders carry `LaikaFolder` — and the hierarchy is encoded as
 * `[:CHILD_OF]` relationships pointing from children to their parents:
 *
 *     (notes/hello.md:LaikaFile)-[:CHILD_OF]->(notes:LaikaFolder)
 *
 * Five Cypher idioms shape the wire format:
 *
 *  - **Node pattern matching with labels.** `(f:LaikaFile {path: $path})`
 *    binds a node by label-and-property. First backend in the suite
 *    with label-as-discriminator at the wire level.
 *
 *  - **Arrow-relationship syntax.** `(child)-[:CHILD_OF]->(parent)`. The
 *    direction matters — Cypher arrows are part of the pattern grammar.
 *
 *  - **`DETACH DELETE`.** Removes a node and every relationship attached
 *    to it in one statement. **First cascading-delete primitive in the
 *    suite.**
 *
 *  - **Multi-statement transactional commit.** Each Laika operation
 *    that touches >1 graph element ships as a single `tx/commit`
 *    body with N statements — atomic at the endpoint, no `BEGIN`/`COMMIT`
 *    keywords needed (unlike SurrealDB). **The 14th structurally
 *    distinct atomic-multi-write mechanism in the suite.**
 *
 *  - **`MERGE` for idempotent folder creation.** `MERGE (f:LaikaFolder
 *    {path: $path})` either matches an existing node or creates a new
 *    one — Cypher's get-or-create primitive.
 */
export class Neo4jStorageRepository extends StorageRepository {
  private readonly dataSource: Neo4jDataSource;
  private readonly fileLabel: string;
  private readonly folderLabel: string;
  private readonly relationshipType: string;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: Neo4jStorageRepositoryOptions) {
    super();
    const {
      dataSource,
      fileLabel = DEFAULT_FILE_LABEL,
      folderLabel = DEFAULT_FOLDER_LABEL,
      relationshipType = DEFAULT_RELATIONSHIP_TYPE,
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      determineExtension = defaultDetermineExtension,
    } = options;

    validateLabel(fileLabel);
    validateLabel(folderLabel);
    validateRelType(relationshipType);

    this.dataSource = dataSource;
    this.fileLabel = fileLabel;
    this.folderLabel = folderLabel;
    this.relationshipType = relationshipType;
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

  private filePath(key: string, extension: string): string {
    const stripped = stripSlashes(this.stripExtension(key));
    return `${stripped}.${extension}`;
  }

  /**
   * Resolve an extension-free key to its file node. One Cypher statement:
   *
   *     MATCH (f:LaikaFile {parent: $parent, name: $name}) RETURN f LIMIT 1
   *
   * Indexed lookup on `(parent, name)` if the user has defined the
   * recommended index (see README).
   */
  private async findFileNode(key: string): Promise<StoredNode | null> {
    const { parent, name } = splitPath(this.stripExtension(key));
    const r = await this.dataSource.run(
      `MATCH (f:${this.fileLabel} {parent: $parent, name: $name}) RETURN f LIMIT 1`,
      { parent, name },
    );
    if (Result.isFailure(r)) return null;
    return firstNodeProps<StoredNode>(r.success);
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const node = yield* Effect.promise(() => this.findFileNode(key));
        if (!node) {
          return yield* Effect.fail(new NotFoundError(`Neo4j file node not found: ${key}`));
        }
        const extension = node.extension ?? this.defaultFileExtension;
        const content = yield* Effect.promise(() => this.deserialize(extension, node.content ?? ''));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: node.createdAt ?? new Date(0).toISOString(),
          updatedAt: node.updatedAt ?? new Date(0).toISOString(),
          content,
          // The node's logical id — `<label>:<path>` — surfaces as revisionId.
          // Neo4j has element-ids (`elementId(f)`) but they're per-instance,
          // not stable across restores. Path is the stable identifier.
          metadata: { extension, revisionId: `${this.fileLabel}:${node.path}` },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(key);
        if (k === '') {
          // Root — exist if anything exists with no [:CHILD_OF]->().
          const r = yield* liftResult(this.dataSource.run(
            // The square brackets around CHILD_OF make it a relationship pattern.
            `MATCH (n) WHERE (n:${this.fileLabel} OR n:${this.folderLabel}) AND NOT (n)-[:${this.relationshipType}]->() RETURN n LIMIT 1`,
          ));
          if (r.data.length === 0) {
            return yield* Effect.fail(new NotFoundError('Neo4j root folder is empty'));
          }
          const now = new Date().toISOString();
          return { type: 'folder', key: '', createdAt: now, updatedAt: now } satisfies Folder;
        }
        // Explicit folder node?
        const explicit = yield* liftResult(this.dataSource.run(
          `MATCH (f:${this.folderLabel} {path: $path}) RETURN f LIMIT 1`,
          { path: k },
        ));
        const node = firstNodeProps<StoredNode>(explicit);
        if (node) {
          return {
            type: 'folder',
            key: k,
            createdAt: node.createdAt ?? new Date(0).toISOString(),
            updatedAt: node.updatedAt ?? new Date(0).toISOString(),
          } satisfies Folder;
        }
        // Implicit folder — any descendant?
        const implicit = yield* liftResult(this.dataSource.run(
          `MATCH (c) WHERE c.parent = $parent RETURN c LIMIT 1`,
          { parent: k },
        ));
        if (implicit.data.length > 0) {
          const now = new Date().toISOString();
          return { type: 'folder', key: k, createdAt: now, updatedAt: now } satisfies Folder;
        }
        return yield* Effect.fail(new NotFoundError(`Neo4j folder not found: ${k}`));
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const file = yield* Effect.promise(() => this.findFileNode(key));
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
        const existing = yield* Effect.promise(() => this.findFileNode(create.key));
        if (existing) {
          return yield* Effect.fail(
            new EntryAlreadyExistsError(
              `An object with key "${create.key}" already exists with extension .${
                existing.extension ?? this.defaultFileExtension
              }`,
            ),
          );
        }
        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const { parent, name } = splitPath(this.stripExtension(create.key));
        const fullPath = this.filePath(create.key, extension);
        const now = new Date().toISOString();

        // Two-statement transaction in ONE `tx/commit` body:
        //   1. CREATE the file node with all properties.
        //   2. MERGE (or skip, if parent is '') the parent folder and the
        //      [:CHILD_OF] relationship.
        // The whole thing is atomic at the endpoint — partial failures
        // roll back.
        const statements: CypherStatement[] = [
          {
            statement:
              `CREATE (f:${this.fileLabel} {path: $path, parent: $parent, name: $name, extension: $extension, content: $content, createdAt: $now, updatedAt: $now}) RETURN f`,
            parameters: { path: fullPath, parent, name, extension, content: serialized, now },
          },
        ];
        if (parent !== '') {
          statements.push({
            statement: `MATCH (f:${this.fileLabel} {path: $path})
               MERGE (p:${this.folderLabel} {path: $parent})
                 ON CREATE SET p.name = $parentName, p.parent = $parentParent, p.createdAt = $now, p.updatedAt = $now
               MERGE (f)-[:${this.relationshipType}]->(p)`,
            parameters: {
              path: fullPath,
              parent,
              parentName: parent.includes('/') ? parent.slice(parent.lastIndexOf('/') + 1) : parent,
              parentParent: parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '',
              now,
            },
          });
        }
        yield* liftResult(this.dataSource.batch(statements));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileNode(update.key));
        if (!existing) {
          return yield* Effect.fail(new NotFoundError(`Neo4j file node not found: ${update.key}`));
        }
        if (update.content) {
          const extension = existing.extension ?? this.defaultFileExtension;
          const serialized = yield* Effect.promise(() => this.serialize(extension, update.content!));
          // `SET` overwrites the named properties; `+=` would merge.
          yield* liftResult(this.dataSource.run(
            `MATCH (f:${this.fileLabel} {path: $path}) SET f.content = $content, f.updatedAt = $now RETURN f`,
            { path: existing.path, content: serialized, now: new Date().toISOString() },
          ));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.findFileNode(create.key));
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
        const { parent, name } = splitPath(k);
        const now = new Date().toISOString();
        // `MERGE` is Cypher's idempotent get-or-create. If the node
        // already exists, it just matches; otherwise the `ON CREATE SET`
        // clause initialises it. First backend in the suite using
        // MERGE/ON CREATE.
        const statements: CypherStatement[] = [
          {
            statement: `MERGE (f:${this.folderLabel} {path: $path})
                 ON CREATE SET f.name = $name, f.parent = $parent, f.createdAt = $now, f.updatedAt = $now`,
            parameters: { path: k, name, parent, now },
          },
        ];
        if (parent !== '') {
          statements.push({
            statement: `MATCH (f:${this.folderLabel} {path: $path})
               MERGE (p:${this.folderLabel} {path: $parent})
                 ON CREATE SET p.name = $parentName, p.parent = $parentParent, p.createdAt = $now, p.updatedAt = $now
               MERGE (f)-[:${this.relationshipType}]->(p)`,
            parameters: {
              path: k,
              parent,
              parentName: parent.includes('/') ? parent.slice(parent.lastIndexOf('/') + 1) : parent,
              parentParent: parent.includes('/') ? parent.slice(0, parent.lastIndexOf('/')) : '',
              now,
            },
          });
        }
        yield* liftResult(this.dataSource.batch(statements));
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

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

        // ── Round-trip 1: resolve every key to its node path via parallel finds.
        const resolved = yield* Effect.promise(async () => {
          const out: Array<{ key: string, resolved: StoredNode | null }> = [];
          for (const k of cleanKeys) {
            out.push({ key: k, resolved: await this.findFileNode(k) });
          }
          return out;
        });

        const found = resolved.filter(r => r.resolved !== null) as Array<{ key: string, resolved: StoredNode }>;
        const missing = resolved.filter(r => r.resolved === null);

        // ── Round-trip 2: ONE `tx/commit` body with N `DETACH DELETE`
        // statements. Atomic — partial failures roll back. DETACH means
        // the [:CHILD_OF] relationships go too. **14th structurally
        // distinct atomic-multi-write mechanism in the suite.**
        if (found.length > 0) {
          yield* liftResult(this.dataSource.batch(
            found.map(f => ({
              statement: `MATCH (f:${this.fileLabel} {path: $path}) DETACH DELETE f`,
              parameters: { path: f.resolved.path },
            })),
          ));
        }

        for (const f of found) yield* emit.data(f.key);
        for (const m of missing) {
          yield* emit.recoverableError(new NotFoundError(`Neo4j file node not found: ${m.key}`));
        }
        return { removed: found.length, skipped: skipped0 + missing.length };
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
   * One Cypher pattern-match traversing incoming `[:CHILD_OF]`
   * relationships:
   *
   *     MATCH (p:LaikaFolder {path: $parent})<-[:CHILD_OF]-(c)
   *     RETURN c
   *
   * The `<-[:CHILD_OF]-` arrow is the load-bearing bit — first backend
   * using graph traversal as a listing primitive.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const k = stripSlashes(folderKey);
      const cypher = k === ''
        // Root: nodes with no outgoing [:CHILD_OF] edge.
        ? `MATCH (c) WHERE (c:${this.fileLabel} OR c:${this.folderLabel}) AND NOT (c)-[:${this.relationshipType}]->() RETURN c`
        // Subfolder: incoming-edge traversal.
        : `MATCH (p:${this.folderLabel} {path: $parent})<-[:${this.relationshipType}]-(c) RETURN c`;
      const result = yield* liftResult(this.dataSource.run(
        cypher,
        k === '' ? {} : { parent: k },
      ));
      const nodes = allNodeProps<StoredNode & { __label?: string }>(result);

      const callerPrefix = k === '' ? '' : `${k}/`;
      const summaries: AtomSummary[] = [];
      for (const node of nodes) {
        // The result row doesn't carry the label inline — infer from `extension`.
        const isFile = node.extension !== undefined;
        if (isFile) {
          summaries.push({ type: 'object-summary', key: callerPrefix + node.name });
        } else {
          summaries.push({ type: 'folder-summary', key: callerPrefix + node.name });
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
          'Each object is one Neo4j node with the :LaikaFile label; the extension is stored as the `extension` property.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over Cypher result rows; native SKIP/LIMIT pushdown not yet wired.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}
