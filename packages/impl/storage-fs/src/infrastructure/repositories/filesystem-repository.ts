import type { LaikaError, LaikaResult } from '@laikacms/core';
import { BadRequestError, EntryAlreadyExistsError, InvalidData } from '@laikacms/core';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsOptions,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageSerializerRegistry} from '@laikacms/storage';
import {
  pathCombine,
  StorageRepository
} from '@laikacms/storage';
import * as Result from 'effect/Result';
import * as minimatch from 'minimatch';
import { FileSystemDataSource } from '../datasources/filesystem-datasource.js';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

export class FileSystemStorageRepository extends StorageRepository {
  private excludeFilter: minimatch.MMRegExp[];
  private fileSystemDataSource: FileSystemDataSource;

  constructor(
    private readonly rootDirectory: string,
    private readonly serializerRegistry: StorageSerializerRegistry,
    private readonly defaultFileExtension: string,
    private readonly ignoreList: string[] = [
      '**/.keep',
      '**/.DS_Store',
      '**/Thumbs.db',
      '**/desktop.ini',
      '**/.contentbase',
      '**/.laikacms',
    ],
  ) {
    super();
    const availableExtensions = Object.keys(this.serializerRegistry);
    this.fileSystemDataSource = new FileSystemDataSource(availableExtensions, defaultFileExtension);
    this.excludeFilter = this.ignoreList.map(pattern => minimatch.makeRe(pattern, { dot: true, partial: true })).filter(
      x => x !== false,
    );
  }

  /**
   * Serialize StorageObjectContent to string based on file extension
   */
  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    ext.startsWith('.') && (ext = ext.slice(1));
    const serializer = this.serializerRegistry[ext];

    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }

    try {
      return await serializer.serializeDocumentFileContents(content, {});
    } catch (error) {
      console.error(error);
      throw new BadRequestError(
        `Failed to serialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Deserialize string content to StorageObjectContent based on file extension
   */
  private async deserialize(ext: string, content: string): Promise<StorageObjectContent> {
    ext.startsWith('.') && (ext = ext.slice(1));
    const serializer = this.serializerRegistry[ext];

    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. `
          + `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`,
      );
    }

    try {
      return await serializer.deserializeDocumentFileContents(content, {});
    } catch (error) {
      console.error(error);
      throw new BadRequestError(
        `Failed to deserialize content: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async *removeAtoms(
    keys: readonly string[],
  ): AsyncGenerator<LaikaResult<readonly string[]>> {
    const dirSubToAtomMapping = new Map<string, string>();

    const result = await this.fileSystemDataSource.deleteEntries(
      this.rootDirectory,
      keys.map(path => ({ path, type: 'file' as const })),
    );

    if (Result.isSuccess(result)) {
      const resultAtoms = result.success
        .map(dirSub => dirSubToAtomMapping.get(dirSub.path))
        .filter(Boolean) as string[];
      yield Result.succeed(resultAtoms as readonly string[]);
    } else {
      yield failAs<readonly string[]>(result.failure);
    }
  }

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    const dirSubs = await this.fileSystemDataSource.getDirMeta(
      this.rootDirectory,
      key,
    );

    if (Result.isFailure(dirSubs)) {
      yield failAs<Folder>(dirSubs.failure);
      return;
    }

    const folder: Folder = {
      type: 'folder',
      key,
      createdAt: dirSubs.success.createdAt.toISOString(),
      updatedAt: dirSubs.success.updatedAt.toISOString(),
    };

    yield Result.succeed(folder);
  }

  async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
    const isDir = await this.fileSystemDataSource.isDir(
      this.rootDirectory,
      key,
    );

    const type = isDir
      ? 'dir'
      : 'file';

    if (type === 'file') {
      yield* this.getObject(key);
    } else if (type === 'dir') {
      yield* this.getFolder(key);
    } else {
      yield Result.fail(new BadRequestError('Invalid type: ' + type));
    }
  }

  async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
    const [fileMetaResult, fileContentResult] = await Promise.all([
      this.fileSystemDataSource.getFileMeta(
        this.rootDirectory,
        key,
      ),
      this.fileSystemDataSource.getFileContents(
        this.rootDirectory,
        key,
      ),
    ]);

    if (Result.isFailure(fileMetaResult)) {
      yield failAs<StorageObject>(fileMetaResult.failure);
      return;
    }
    if (Result.isFailure(fileContentResult)) {
      yield failAs<StorageObject>(fileContentResult.failure);
      return;
    }

    // Use the path without extension from the datasource
    const keyWithoutExt = fileContentResult.success.path;
    const ext = fileContentResult.success.extension;

    const storageObject: StorageObject = {
      type: 'object',
      key: keyWithoutExt,
      createdAt: fileMetaResult.success.createdAt.toISOString(),
      updatedAt: fileMetaResult.success.updatedAt.toISOString(),
      content: await this.deserialize(ext, fileContentResult.success.content),
    };

    yield Result.succeed(storageObject);
  }

  async *updateObject(update: StorageObjectUpdate): AsyncGenerator<LaikaResult<StorageObject>> {
    // First resolve the key to get the actual file extension
    const fileMetaResult = await this.fileSystemDataSource.getFileMeta(
      this.rootDirectory,
      update.key,
    );

    if (Result.isFailure(fileMetaResult)) {
      yield failAs<StorageObject>(fileMetaResult.failure);
      return;
    }

    const ext = fileMetaResult.success.extension;
    const stringified = update.content ? await this.serialize(ext, update.content) : undefined;

    if (stringified) {
      const updateResult = await this.fileSystemDataSource.createOrUpdate(
        this.rootDirectory,
        update.key,
        stringified,
        ext,
      );
      if (Result.isFailure(updateResult)) {
        yield failAs<StorageObject>(updateResult.failure);
        return;
      }
    }

    yield* this.getObject(update.key);
  }

  async *createObject(create: StorageObjectCreate): AsyncGenerator<LaikaResult<StorageObject>> {
    if (!create.content) {
      yield Result.fail(new InvalidData('Object content is required for creation'));
      return;
    }

    // Check if an object with this key already exists with any available extension
    const existingExt = await this.fileSystemDataSource.findExistingFileExtension(
      this.rootDirectory,
      create.key,
    );

    if (existingExt) {
      yield Result.fail(
        new EntryAlreadyExistsError(
          `An object with key "${create.key}" already exists with extension .${existingExt}`,
        ),
      );
      return;
    }

    // Use the default file extension for new objects
    const ext = this.defaultFileExtension;
    const stringified = await this.serialize(ext, create.content);

    const createResult = await this.fileSystemDataSource.createOrUpdate(
      this.rootDirectory,
      create.key,
      stringified,
      ext,
    );

    if (Result.isFailure(createResult)) {
      yield failAs<StorageObject>(createResult.failure);
      return;
    }

    yield* this.getObject(create.key);
  }

  async *createOrUpdateObject(create: StorageObjectCreate): AsyncGenerator<LaikaResult<StorageObject>> {
    const ext = await this.fileSystemDataSource.findExistingFileExtension(
      this.rootDirectory,
      create.key,
    ) || this.defaultFileExtension;

    const createResult = await this.fileSystemDataSource.createOrUpdate(
      this.rootDirectory,
      create.key,
      create.content ? await this.serialize(ext, create.content) : '',
      ext,
    );

    if (Result.isFailure(createResult)) {
      yield failAs<StorageObject>(createResult.failure);
      return;
    }

    yield* this.getObject(create.key);
  }

  async *createFolder(folderCreate: FolderCreate): AsyncGenerator<LaikaResult<Folder>> {
    const createResult = await this.fileSystemDataSource.createOrUpdate(
      this.rootDirectory,
      pathCombine(folderCreate.key, '.keep'),
      '',
      '', // .keep files don't need an extension
    );

    if (Result.isFailure(createResult)) {
      yield failAs<Folder>(createResult.failure);
      return;
    }

    yield* this.getFolder(folderCreate.key);
  }

  listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly AtomSummary[]>> {
    return this.getAtomsList<AtomSummary>(folderKey, options, true);
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    return this.getAtomsList<Atom>(folderKey, options, false);
  }

  private async *getAtomsList<T extends AtomSummary | Atom>(
    folderKey: string,
    options: ListAtomsOptions,
    summariesOnly: T extends AtomSummary ? true : false,
  ): AsyncGenerator<LaikaResult<readonly T[]>> {
    const dirSubs = await this.fileSystemDataSource.listFileSystemDirectory(
      this.rootDirectory,
      folderKey,
    );

    if (Result.isFailure(dirSubs)) {
      yield failAs<readonly T[]>(dirSubs.failure);
      return;
    }

    const availableExtensions = Object.keys(this.serializerRegistry);

    const filteredDirSubs = dirSubs.success.filter((dirSub: { path: string, type: string }) => {
      return this.excludeFilter.every(pattern => !pattern.test(dirSub.path));
    }).map((dirSub: { path: string, type: string }) => {
      let key = dirSub.path;

      // Strip extension from files if it matches an available extension
      if (dirSub.type === 'file') {
        for (const ext of availableExtensions) {
          if (key.endsWith(`.${ext}`)) {
            key = key.slice(0, -(ext.length + 1));
            break;
          }
        }
      }

      const atomSummary = {
        type: dirSub.type === 'file' ? 'object-summary' : 'folder-summary',
        key: key,
      } satisfies AtomSummary;
      return atomSummary;
    });

    if (summariesOnly) {
      yield Result.succeed(filteredDirSubs as unknown as readonly T[]);
      return;
    }

    const atoms: T[] = [];
    for (const dirSub of filteredDirSubs) {
      if (dirSub.type === 'object-summary') {
        for await (const objectResult of this.getObject(dirSub.key)) {
          if (Result.isSuccess(objectResult)) {
            atoms.push(objectResult.success as unknown as T);
          }
        }
      } else if (dirSub.type === 'folder-summary') {
        for await (const folderResult of this.getFolder(dirSub.key)) {
          if (Result.isSuccess(folderResult)) {
            atoms.push(folderResult.success as unknown as T);
          }
        }
      }
    }

    yield Result.succeed(atoms as readonly T[]);
  }
}
