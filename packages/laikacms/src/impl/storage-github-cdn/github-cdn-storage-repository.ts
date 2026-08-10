import * as Effect from 'effect/Effect';
import * as Result from 'effect/Result';

import {
  BadRequestError,
  type LaikaError,
  type LaikaResult,
  LaikaStream,
  LaikaTask,
  NotFoundError,
  NotImplementedError,
} from 'laikacms/core';
import {
  applyPagination,
  type Atom,
  type AtomSummary,
  Capabilities,
  collectAtomSummariesWithDepth,
  CompatibilityDate,
  type Folder,
  type FolderCreate,
  type ListAtomsDone,
  type ListAtomsOptions,
  type RemoveAtomsDone,
  type StorageObject,
  type StorageObjectContent,
  type StorageObjectCreate,
  type StorageObjectUpdate,
  StorageRepository,
  type StorageSerializerRegistry,
  unsupportedChanges,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';

import { GithubCdnDataSource, type GithubCdnDataSourceOptions } from './github-cdn-datasource.js';

export type GithubCdnStorageRepositoryOptions = GithubCdnDataSourceOptions & {
  serializerRegistry: StorageSerializerRegistry,
  ignoreList?: string[],
};

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.catalog',
  '**/.laikacms',
];

const liftResult = <A>(p: Promise<LaikaResult<A>>): Effect.Effect<A, LaikaError> =>
  Effect.flatMap(Effect.promise(() => p), Effect.fromResult);

const READ_ONLY = 'This repository is backed by a public GitHub CDN and is read-only.';

/**
 * Read-only {@link StorageRepository} backed by a *public* GitHub repository, served
 * from CDNs with no credentials and no `@octokit/*` dependency. See
 * {@link GithubCdnDataSource} for the metadata/freshness trade-offs.
 *
 * All mutating operations fail with {@link NotImplementedError}.
 */
export class GithubCdnStorageRepository extends StorageRepository {
  private readonly dataSource: GithubCdnDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly availableExtensions: string[];
  private readonly excludeFilter: minimatch.MMRegExp[];

  constructor(options: GithubCdnStorageRepositoryOptions) {
    super();
    const {
      serializerRegistry,
      ignoreList = DEFAULT_IGNORE_LIST,
      ...dataSourceOptions
    } = options;

    this.serializerRegistry = serializerRegistry;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.dataSource = new GithubCdnDataSource(dataSourceOptions);
    this.excludeFilter = ignoreList
      .map(p => minimatch.makeRe(p, { dot: true, partial: true }))
      .filter((x): x is minimatch.MMRegExp => x !== false);
  }

  private stripExtension(p: string): string {
    for (const ext of this.availableExtensions) {
      if (p.endsWith(`.${ext}`)) return p.slice(0, -(ext.length + 1));
    }
    return p;
  }

  private async resolvePathWithExtension(
    key: string,
  ): Promise<{ path: string, extension: string } | null> {
    const base = this.stripExtension(key);
    for (const ext of this.availableExtensions) {
      const candidate = `${base}.${ext}`;
      const meta = await this.dataSource.getFileMeta(candidate);
      if (Result.isSuccess(meta)) return { path: candidate, extension: ext };
    }
    return null;
  }

  private async deserialize(ext: string, content: string): Promise<StorageObjectContent> {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    const serializer = this.serializerRegistry[cleanExt];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${cleanExt}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    return serializer.deserializeDocumentFileContents(content, {});
  }

  getObject(key: string): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.make<StorageObject>(() =>
      Effect.gen({ self: this }, function*() {
        const resolved = yield* Effect.promise(() => this.resolvePathWithExtension(key));
        if (!resolved) {
          return yield* Effect.fail(new NotFoundError(`The file at ${key} does not exist`));
        }
        const [content, meta] = yield* Effect.all(
          [
            liftResult(this.dataSource.getFileContents(resolved.path)),
            liftResult(this.dataSource.getFileMeta(resolved.path)),
          ],
          { concurrency: 2 },
        );
        const deserialized = yield* Effect.promise(() => this.deserialize(resolved.extension, content.content));
        return {
          type: 'object',
          key: this.stripExtension(resolved.path),
          createdAt: meta.createdAt.toISOString(),
          updatedAt: meta.updatedAt.toISOString(),
          content: deserialized,
          metadata: { extension: resolved.extension, revisionId: meta.sha },
        } satisfies StorageObject;
      })
    );
  }

  getFolder(key: string): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.make<Folder>(() =>
      Effect.gen({ self: this }, function*() {
        yield* liftResult(this.dataSource.listDirectory(key));
        const now = new Date(0).toISOString();
        return { type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder;
      })
    );
  }

  getAtom(key: string): LaikaTask.LaikaTask<Atom> {
    return LaikaTask.make<Atom>(() =>
      Effect.gen({ self: this }, function*() {
        const typeResult = yield* Effect.result(
          Effect.tryPromise({
            try: () => this.dataSource.pathType(key),
            catch: e =>
              e instanceof NotFoundError
                ? e
                : e instanceof Error
                ? new BadRequestError(e.message)
                : new BadRequestError(String(e)),
          }),
        );
        // pathType failures (incl. NotFound) → probe as file with an extension via getObject.
        if (typeResult._tag === 'Failure') {
          return yield* LaikaTask.runValue(this.getObject(key));
        }
        if (typeResult.success === 'file') {
          return yield* LaikaTask.runValue(this.getObject(key));
        }
        return yield* LaikaTask.runValue(this.getFolder(key));
      })
    );
  }

  listAtomSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone> {
    return LaikaStream.make<AtomSummary, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, aggregateTotal } = yield* this.collectFilteredSummaries(folderKey, options);
        if (summaries.length > 0) yield* emit.dataMany(summaries);
        return { total: aggregateTotal };
      })
    );
  }

  listAtoms(
    folderKey: string,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone> {
    return LaikaStream.make<Atom, ListAtomsDone>(emit =>
      Effect.gen({ self: this }, function*() {
        const { summaries, aggregateTotal } = yield* this.collectFilteredSummaries(folderKey, options);
        for (const summary of summaries) {
          if (summary.type === 'object-summary') {
            const r = yield* Effect.result(LaikaTask.runValue(this.getObject(summary.key)));
            if (Result.isFailure(r)) yield* emit.recoverableError(r.failure);
            else yield* emit.data(r.success);
          } else {
            const r = yield* Effect.result(LaikaTask.runValue(this.getFolder(summary.key)));
            if (Result.isFailure(r)) yield* emit.recoverableError(r.failure);
            else yield* emit.data(r.success);
          }
        }
        return { total: aggregateTotal };
      })
    );
  }

  private collectFilteredSummaries(
    folderKey: string,
    options: ListAtomsOptions,
  ): Effect.Effect<{ summaries: ReadonlyArray<AtomSummary>, aggregateTotal: number }, LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const all = yield* collectAtomSummariesWithDepth(folderKey, key => this.listFolderLevel(key), options.depth);
      const aggregateTotal = all.length;
      return { summaries: applyPagination(all, options.pagination), aggregateTotal };
    });
  }

  private listFolderLevel(folderKey: string): Effect.Effect<AtomSummary[], LaikaError> {
    return Effect.gen({ self: this }, function*() {
      const listing = yield* liftResult(this.dataSource.listDirectory(folderKey));
      const filtered = listing.filter(
        entry => this.excludeFilter.every(re => !re.test(entry.path)),
      );
      const summaries: AtomSummary[] = filtered.map(entry => {
        let key = entry.path;
        if (entry.type === 'file') {
          for (const ext of this.availableExtensions) {
            if (key.endsWith(`.${ext}`)) {
              key = key.slice(0, -(ext.length + 1));
              break;
            }
          }
        }
        return {
          type: entry.type === 'file' ? 'object-summary' : 'folder-summary',
          key,
        };
      });
      return summaries;
    });
  }

  getCapabilities(): LaikaTask.LaikaTask<Capabilities> {
    return LaikaTask.succeed<Capabilities>({
      fileExtensions: {
        supported: true,
        description: 'Supported file types depend on the serializers provided to this repository.',
        supportedExtensions: this.serializerRegistry,
      },
      pagination: {
        supported: true,
        description: 'In-memory slicing over the jsDelivr tree listing; cursor pagination is not supported.',
        styles: { offset: true, page: true, cursor: false },
      },
      changes: unsupportedChanges,
      compatibilityDate: CompatibilityDate.make('2024-06-01'),
    });
  }

  // ── Mutations: unsupported (public CDN, read-only) ──────────────────────────

  createObject(_create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.fail(new NotImplementedError(READ_ONLY));
  }

  updateObject(_update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.fail(new NotImplementedError(READ_ONLY));
  }

  createOrUpdateObject(_create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject> {
    return LaikaTask.fail(new NotImplementedError(READ_ONLY));
  }

  createFolder(_folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder> {
    return LaikaTask.fail(new NotImplementedError(READ_ONLY));
  }

  removeAtoms(_keys: readonly string[]): LaikaStream.LaikaStream<string, RemoveAtomsDone> {
    return LaikaStream.fail(new NotImplementedError(READ_ONLY));
  }
}
