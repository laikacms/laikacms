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

import type { SolidDataSource } from './solid-datasource.js';

export interface SolidStorageRepositoryOptions {
  readonly dataSource: SolidDataSource;
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
  '**/.acl',
  '**/.meta',
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
 * A {@link StorageRepository} backed by a Solid Pod / LDP-compatible
 * server. Resources at URIs, folders at trailing-slash URIs, listings
 * as Turtle.
 *
 * URL layout:
 *
 *     <podRoot>notes/                ← LDP basic container (folder)
 *     <podRoot>notes/hello.md        ← LDP RDF resource (file)
 *     <podRoot>notes/.acl            ← WAC ACL (out of scope for v1)
 *
 * The repository never touches `.acl` resources directly — those live
 * with whoever provisioned the Pod. Five distinguishing traits:
 *
 *  - **URI-as-identity.** Every resource is at its canonical URL. The
 *    surfaced `revisionId` is the ETag from the server when present, or
 *    the URL itself as a fallback.
 *
 *  - **Trailing-slash addressing.** Folder URLs end in `/`, file URLs do
 *    not. The repository builds these URLs deterministically from the
 *    Laika key.
 *
 *  - **RDF/Turtle container listings.** `listContainer()` GETs the
 *    container with `Accept: text/turtle`, parses the response, and
 *    returns each `ldp:contains` child URL with a container/resource
 *    discriminator.
 *
 *  - **Content negotiation by file extension.** `application/json` for
 *    `.json` files, `text/markdown` for `.md`, etc. The repository sets
 *    `Content-Type` on PUT and accepts whatever the server returns on GET.
 *
 *  - **`If-None-Match: *` for create-only PUTs.** The repository emits
 *    this header on `createObject` so a concurrent writer can't silently
 *    overwrite. 412 Precondition Failed → `EntryAlreadyExistsError`.
 *
 * `removeAtoms(N)` does NOT pack into a single round-trip — LDP has no
 * native bulk endpoint, and SPARQL UPDATE isn't part of the core spec
 * either. We do N parallel DELETEs. The README documents this honestly.
 */
export class SolidStorageRepository extends StorageRepository {
  private readonly dataSource: SolidDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: readonly string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly determineExtension: DetermineExtension;

  constructor(options: SolidStorageRepositoryOptions) {
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

  // ───────────────────────── URL builders ─────────────────────────

  /** URL of a file resource. */
  private fileUrl(key: string, extension: string): string {
    const k = stripSlashes(this.stripExtension(key));
    return this.dataSource.resolveUrl(`${k}.${extension}`);
  }

  /** URL of a container — always trailing-slash. */
  private folderUrl(key: string): string {
    const k = stripSlashes(key);
    if (k === '') return this.dataSource.podRoot;
    return this.dataSource.resolveUrl(`${k}/`);
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

  /**
   * Resolve an extension-free key to its `(url, extension)` pair via
   * parallel HEADs across the registered extensions. With small N
   * (a few formats) this is wall-clock single-round-trip latency.
   */
  private async resolveFile(key: string): Promise<{ url: string, extension: string } | null> {
    const stripped = this.stripExtension(stripSlashes(key));
    const probes = await Promise.all(
      this.availableExtensions.map(async ext => {
        const url = this.fileUrl(stripped, ext);
        const r = await this.dataSource.head(url);
        return Result.isSuccess(r) && r.success ? { url, extension: ext } : null;
      }),
    );
    return probes.find(p => p !== null) ?? null;
  }

  /** Ensure every ancestor container exists. */
  private async ensureAncestorContainers(key: string): Promise<LaikaResult<void>> {
    const segments = stripSlashes(this.stripExtension(key)).split('/').filter(s => s !== '');
    const ancestors = segments.slice(0, -1);
    for (let i = 0; i < ancestors.length; i += 1) {
      const partial = ancestors.slice(0, i + 1).join('/');
      const url = this.folderUrl(partial);
      // HEAD probe — if it exists, skip; otherwise create.
      const exists = await this.dataSource.head(url);
      if (Result.isSuccess(exists) && exists.success) continue;
      const create = await this.dataSource.createContainer(url);
      if (Result.isFailure(create)) {
        // 412 / EntryAlreadyExists is fine — race condition or pre-existing.
        if (!(create.failure instanceof EntryAlreadyExistsError)) return create;
      }
    }
    return Result.succeed(undefined);
  }

  // ───────────────────────── contract methods ─────────────────────────

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolveFile(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`Solid resource not found: ${key}`));
        }
        const resource = yield* liftResult(this.dataSource.getResource(resolved.url));
        if (!resource) {
          return yield* Effect.fail(new NotFoundError(`Solid resource disappeared: ${key}`));
        }
        const content = yield* Effect.promise(() => this.deserialize(resolved.extension, resource.content));
        return {
          type: 'object',
          key: stripSlashes(key),
          createdAt: resource.lastModified ?? new Date(0).toISOString(),
          updatedAt: resource.lastModified ?? new Date(0).toISOString(),
          content,
          metadata: {
            extension: resolved.extension,
            // URI as identity — the URL IS the revisionId for backends
            // without ETags. When the server emits an ETag we prefer that.
            revisionId: resource.etag ?? resolved.url,
          },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const url = this.folderUrl(key);
        const exists = yield* liftResult(this.dataSource.head(url));
        if (!exists) {
          return yield* Effect.fail(new NotFoundError(`Solid container not found: ${key || '<root>'}`));
        }
        const now = new Date().toISOString();
        return { type: 'folder', key: stripSlashes(key), createdAt: now, updatedAt: now } satisfies Folder;
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
        // Ancestors first — LDP servers vary on auto-creating intermediate
        // containers, so we do it explicitly.
        yield* liftResult(this.ensureAncestorContainers(create.key));

        const extension = this.resolveExtension(create.key, create.metadata);
        const serialized = yield* Effect.promise(() => this.serialize(extension, create.content));
        const url = this.fileUrl(create.key, extension);
        yield* liftResult(this.dataSource.putResource(url, serialized, {
          contentType: contentTypeFor(extension),
          createOnly: true, // `If-None-Match: *` — first true create-only via HTTP precondition in the suite
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
          return yield* Effect.fail(new NotFoundError(`Solid resource not found: ${update.key}`));
        }
        if (update.content) {
          const serialized = yield* Effect.promise(() => this.serialize(existing.extension, update.content!));
          yield* liftResult(this.dataSource.putResource(existing.url, serialized, {
            contentType: contentTypeFor(existing.extension),
          }));
        }
        return yield* LaikaTask.runValue(this.getObject(update.key));
      })
    );
  }

  createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const existing = yield* Effect.promise(() => this.resolveFile(create.key));
        const extension = existing?.extension ?? this.resolveExtension(create.key, create.metadata);
        const serialized = create.content
          ? yield* Effect.promise(() => this.serialize(extension, create.content!))
          : '';
        yield* liftResult(this.ensureAncestorContainers(create.key));
        const url = existing?.url ?? this.fileUrl(create.key, extension);
        yield* liftResult(this.dataSource.putResource(url, serialized, {
          contentType: contentTypeFor(extension),
        }));
        return yield* LaikaTask.runValue(this.getObject(create.key));
      })
    );
  }

  createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        const k = stripSlashes(folderCreate.key);
        if (k === '') return yield* LaikaTask.runValue(this.getFolder(''));
        yield* liftResult(this.ensureAncestorContainers(`${k}/.`)); // ensure ancestors AND `k` itself
        return yield* LaikaTask.runValue(this.getFolder(k));
      })
    );
  }

  /**
   * LDP has no native bulk-delete primitive. `removeAtoms(N)` issues N
   * parallel DELETEs and aggregates the results. SPARQL UPDATE (where
   * supported) could do this in one statement on some backends, but it
   * isn't part of the core Solid spec.
   *
   * Per-resource failure semantics:
   *   - 204 / 200 → removed
   *   - 404       → skipped (not found)
   *   - other 4xx → recoverable error
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

        const results = yield* Effect.promise(async () => {
          // Resolve + delete in parallel per key.
          return await Promise.all(cleanKeys.map(async k => {
            const r = await this.resolveFile(k);
            if (!r) return { key: k, outcome: 'missing' as const };
            const del = await this.dataSource.deleteResource(r.url);
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
            yield* emit.recoverableError(new NotFoundError(`Solid resource not found: ${r.key}`));
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
   * One LDP container GET — the Turtle response carries every child via
   * `ldp:contains` triples, no client-side hierarchy reconstruction needed.
   */
  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<ReadonlyArray<AtomSummary>, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const containerUrl = this.folderUrl(folderKey);
      const children = yield* liftResult(this.dataSource.listContainer(containerUrl));

      const callerPrefix = stripSlashes(folderKey) === '' ? '' : `${stripSlashes(folderKey)}/`;
      const summaries: AtomSummary[] = [];
      for (const child of children) {
        // The child URL is absolute; recover the path segment relative to the container.
        const relative = child.url.startsWith(containerUrl)
          ? child.url.slice(containerUrl.length)
          : child.url;
        const trimmed = relative.replace(/\/+$/, '');
        if (trimmed === '') continue;
        if (child.isContainer) {
          summaries.push({ type: 'folder-summary', key: callerPrefix + trimmed });
        } else {
          // Strip a known serializer extension from the file name.
          let name = trimmed;
          for (const ext of this.availableExtensions) {
            if (name.endsWith(`.${ext}`)) {
              name = name.slice(0, -(ext.length + 1));
              break;
            }
          }
          summaries.push({ type: 'object-summary', key: callerPrefix + name });
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
          'Each object is one LDP RDF resource at <podRoot>/<key>.<ext>; the extension is preserved as the URL suffix.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description:
          'In-memory slicing over LDP container Turtle listings; native pagination via Link headers (RFC 5988) not yet pushed down.',
        styles: { offset: true, page: true, cursor: false },
      },
    });
  }
}

/** Best-effort Content-Type for the registered serializer formats. */
const contentTypeFor = (extension: string): string => {
  const map: Record<string, string> = {
    json: 'application/json',
    md: 'text/markdown',
    yaml: 'text/yaml',
    yml: 'text/yaml',
    txt: 'text/plain',
    html: 'text/html',
    xml: 'application/xml',
    ttl: 'text/turtle',
  };
  return map[extension] ?? 'application/octet-stream';
};
