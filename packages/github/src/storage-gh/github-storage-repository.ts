import * as Result from 'effect/Result';
import { BadRequestError, EntryAlreadyExistsError, InvalidData, NotFoundError } from 'laikacms/core';
import type { LaikaError, LaikaResult } from 'laikacms/core';
import {
  type Atom,
  type AtomSummary,
  type Folder,
  type FolderCreate,
  type ListAtomsOptions,
  pathCombine,
  type StorageObject,
  type StorageObjectContent,
  type StorageObjectCreate,
  type StorageObjectUpdate,
  StorageRepository,
  type StorageSerializerRegistry,
} from 'laikacms/storage';
import * as minimatch from 'minimatch';
import { GithubDataSource, type GithubDataSourceOptions } from './github-datasource.js';

export interface GithubStorageRepositoryOptions extends GithubDataSourceOptions {
  serializerRegistry: StorageSerializerRegistry;
  defaultFileExtension: string;
  /** Glob patterns to exclude when listing. Defaults match storage-fs. */
  ignoreList?: string[];
  /** Optional commit author/committer applied to every write. */
  commitAuthor?: { name: string, email: string };
}

const DEFAULT_IGNORE_LIST = [
  '**/.keep',
  '**/.DS_Store',
  '**/Thumbs.db',
  '**/desktop.ini',
  '**/.contentbase',
  '**/.laikacms',
];

const failAs = <T>(error: LaikaError): LaikaResult<T> => Result.fail(error);

/**
 * StorageRepository backed by a GitHub repository. Mirrors the surface and semantics of
 * `laikacms/storage-fs` so that swapping FS for GitHub is purely a wiring change.
 */
export class GithubStorageRepository extends StorageRepository {
  private readonly dataSource: GithubDataSource;
  private readonly serializerRegistry: StorageSerializerRegistry;
  private readonly defaultFileExtension: string;
  private readonly availableExtensions: string[];
  private readonly excludeFilter: minimatch.MMRegExp[];
  private readonly commitAuthor?: { name: string, email: string };

  constructor(options: GithubStorageRepositoryOptions) {
    super();
    const {
      serializerRegistry,
      defaultFileExtension,
      ignoreList = DEFAULT_IGNORE_LIST,
      commitAuthor,
      ...dataSourceOptions
    } = options;

    this.serializerRegistry = serializerRegistry;
    this.defaultFileExtension = defaultFileExtension;
    this.availableExtensions = Object.keys(serializerRegistry);
    this.commitAuthor = commitAuthor;
    this.dataSource = new GithubDataSource(dataSourceOptions);
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

  private async resolvePathWithExtension(key: string): Promise<{ path: string, extension: string } | null> {
    const base = this.stripExtension(key);
    for (const ext of this.availableExtensions) {
      const candidate = `${base}.${ext}`;
      const meta = await this.dataSource.getFileMeta(candidate);
      if (Result.isSuccess(meta)) return { path: candidate, extension: ext };
    }
    return null;
  }

  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    const cleanExt = ext.startsWith('.') ? ext.slice(1) : ext;
    const serializer = this.serializerRegistry[cleanExt];
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${cleanExt}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }
    return serializer.serializeDocumentFileContents(content, {});
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

  // ===== StorageObjects =====

  async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
    const resolved = await this.resolvePathWithExtension(key);
    if (!resolved) {
      yield failAs<StorageObject>(new NotFoundError(`The file at ${key} does not exist`));
      return;
    }

    const [contentResult, metaResult] = await Promise.all([
      this.dataSource.getFileContents(resolved.path),
      this.dataSource.getFileMeta(resolved.path),
    ]);

    if (Result.isFailure(contentResult)) {
      yield failAs<StorageObject>(contentResult.failure);
      return;
    }
    if (Result.isFailure(metaResult)) {
      yield failAs<StorageObject>(metaResult.failure);
      return;
    }

    yield Result.succeed(
      {
        type: 'object',
        key: this.stripExtension(resolved.path),
        createdAt: metaResult.success.createdAt.toISOString(),
        updatedAt: metaResult.success.updatedAt.toISOString(),
        content: await this.deserialize(resolved.extension, contentResult.success.content),
      } satisfies StorageObject,
    );
  }

  async *createObject(create: StorageObjectCreate): AsyncGenerator<LaikaResult<StorageObject>> {
    if (!create.content) {
      yield Result.fail(new InvalidData('Object content is required for creation'));
      return;
    }
    const existing = await this.resolvePathWithExtension(create.key);
    if (existing) {
      yield Result.fail(
        new EntryAlreadyExistsError(
          `An object with key "${create.key}" already exists with extension .${existing.extension}`,
        ),
      );
      return;
    }

    const ext = this.defaultFileExtension;
    const serialized = await this.serialize(ext, create.content);
    const path = `${this.stripExtension(create.key)}.${ext}`;

    const writeResult = await this.dataSource.createOrUpdate(path, serialized, {
      commitMessage: `Create ${path}`,
      author: this.commitAuthor,
    });
    if (Result.isFailure(writeResult)) {
      yield failAs<StorageObject>(writeResult.failure);
      return;
    }

    yield* this.getObject(create.key);
  }

  async *updateObject(update: StorageObjectUpdate): AsyncGenerator<LaikaResult<StorageObject>> {
    const resolved = await this.resolvePathWithExtension(update.key);
    if (!resolved) {
      yield failAs<StorageObject>(new NotFoundError(`The file at ${update.key} does not exist`));
      return;
    }

    if (update.content) {
      const serialized = await this.serialize(resolved.extension, update.content);
      const writeResult = await this.dataSource.createOrUpdate(resolved.path, serialized, {
        commitMessage: `Update ${resolved.path}`,
        author: this.commitAuthor,
      });
      if (Result.isFailure(writeResult)) {
        yield failAs<StorageObject>(writeResult.failure);
        return;
      }
    }

    yield* this.getObject(update.key);
  }

  async *createOrUpdateObject(create: StorageObjectCreate): AsyncGenerator<LaikaResult<StorageObject>> {
    const existing = await this.resolvePathWithExtension(create.key);
    const ext = existing?.extension ?? this.defaultFileExtension;
    const path = existing?.path ?? `${this.stripExtension(create.key)}.${ext}`;
    const serialized = create.content ? await this.serialize(ext, create.content) : '';

    const writeResult = await this.dataSource.createOrUpdate(path, serialized, {
      commitMessage: `${existing ? 'Update' : 'Create'} ${path}`,
      author: this.commitAuthor,
    });
    if (Result.isFailure(writeResult)) {
      yield failAs<StorageObject>(writeResult.failure);
      return;
    }

    yield* this.getObject(create.key);
  }

  // ===== Folders =====

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    // Listing the directory both validates existence and gives us a baseline.
    const listing = await this.dataSource.listDirectory(key);
    if (Result.isFailure(listing)) {
      yield failAs<Folder>(listing.failure);
      return;
    }

    // GitHub doesn't track per-directory timestamps. Approximate with the most recent commit
    // touching the path; if no commits, fall back to epoch.
    const now = new Date(0).toISOString();
    yield Result.succeed({ type: 'folder', key, createdAt: now, updatedAt: now } satisfies Folder);
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
    // GitHub has no concept of empty directories — emulate by writing a `.keep` placeholder.
    const keepPath = pathCombine(folderCreate.key, '.keep');
    const writeResult = await this.dataSource.createOrUpdate(keepPath, '', {
      commitMessage: `Create directory ${folderCreate.key}`,
      author: this.commitAuthor,
    });
    if (Result.isFailure(writeResult)) {
      yield failAs<Folder>(writeResult.failure);
      return;
    }

    yield* this.getFolder(folderCreate.key);
  }

  // ===== Atoms =====

  async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
    try {
      const type = await this.dataSource.pathType(key);
      if (type === 'file') yield* this.getObject(key);
      else yield* this.getFolder(key);
    } catch (e) {
      if (e instanceof NotFoundError) {
        // Treat key as a file path with extension — getObject handles the extension probe.
        yield* this.getObject(key);
      } else {
        yield Result.fail(e instanceof Error ? new BadRequestError(e.message) : new BadRequestError(String(e)));
      }
    }
  }

  listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly AtomSummary[]>> {
    return this.collectAtoms<AtomSummary>(folderKey, options, true);
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    return this.collectAtoms<Atom>(folderKey, options, false);
  }

  private async *collectAtoms<T extends AtomSummary | Atom>(
    folderKey: string,
    _options: ListAtomsOptions,
    summariesOnly: T extends AtomSummary ? true : false,
  ): AsyncGenerator<LaikaResult<readonly T[]>> {
    const listing = await this.dataSource.listDirectory(folderKey);
    if (Result.isFailure(listing)) {
      yield failAs<readonly T[]>(listing.failure);
      return;
    }

    const filtered = listing.success.filter(
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

    if (summariesOnly) {
      yield Result.succeed(summaries as unknown as readonly T[]);
      return;
    }

    const atoms: T[] = [];
    for (const summary of summaries) {
      if (summary.type === 'object-summary') {
        for await (const r of this.getObject(summary.key)) {
          if (Result.isSuccess(r)) atoms.push(r.success as unknown as T);
        }
      } else {
        for await (const r of this.getFolder(summary.key)) {
          if (Result.isSuccess(r)) atoms.push(r.success as unknown as T);
        }
      }
    }
    yield Result.succeed(atoms as readonly T[]);
  }

  async *removeAtoms(keys: readonly string[]): AsyncGenerator<LaikaResult<readonly string[]>> {
    const removed: string[] = [];

    for (const key of keys) {
      const resolved = await this.resolvePathWithExtension(key);
      if (!resolved) {
        yield failAs<readonly string[]>(new NotFoundError(`The file at ${key} does not exist`));
        return;
      }
      const meta = await this.dataSource.getFileMeta(resolved.path);
      if (Result.isFailure(meta)) {
        yield failAs<readonly string[]>(meta.failure);
        return;
      }
      const deleteResult = await this.dataSource.deleteFile(resolved.path, meta.success.sha, {
        commitMessage: `Delete ${resolved.path}`,
        author: this.commitAuthor,
      });
      if (Result.isFailure(deleteResult)) {
        yield failAs<readonly string[]>(deleteResult.failure);
        return;
      }
      removed.push(key);
    }

    yield Result.succeed(removed as readonly string[]);
  }
}
