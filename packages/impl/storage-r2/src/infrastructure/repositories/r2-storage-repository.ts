import { BadRequestError, EntryAlreadyExistsError, InvalidData, LaikaError, LaikaResult } from '@laikacms/core';
import {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  ListAtomsOptions,
  pathCombine,
  StorageObject,
  StorageObjectContent,
  StorageObjectCreate,
  StorageObjectUpdate,
  StorageRepository,
  StorageSerializerRegistry,
} from '@laikacms/storage';
import * as Result from 'effect/Result';
import * as minimatch from 'minimatch';
import { R2DataSource } from '../datasources/r2-datasource.js';

/**
 * Helper to convert a failure result to a different type while preserving the error
 */
function failAs<T>(error: LaikaError): LaikaResult<T> {
  return Result.fail(error);
}

/**
 * R2StorageRepository implements the StorageRepository interface using Cloudflare R2 as the backing store.
 *
 * R2 is a flat object store, so this implementation simulates a hierarchical file system:
 * - Folders are represented by key prefixes
 * - Empty folders are represented by .keep files
 * - File extensions are handled transparently (keys in the API don't include extensions)
 */
export class R2StorageRepository extends StorageRepository {
  private excludeFilter: minimatch.MMRegExp[];
  private r2DataSource: R2DataSource;

  constructor(
    bucket: R2Bucket,
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
    this.r2DataSource = new R2DataSource(bucket, availableExtensions, defaultFileExtension);
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
    const deletedKeys: string[] = [];
    const errors: string[] = [];

    for await (const result of this.r2DataSource.deleteObjects(keys)) {
      if (Result.isSuccess(result)) {
        deletedKeys.push(result.success);
      } else {
        errors.push(result.failure.message);
      }
    }

    if (errors.length > 0 && deletedKeys.length === 0) {
      yield Result.fail(new BadRequestError(`Failed to delete atoms: ${errors.join(', ')}`));
    } else {
      yield Result.succeed(deletedKeys as readonly string[]);
    }
  }

  async *getFolder(key: string): AsyncGenerator<LaikaResult<Folder>> {
    const folderMeta = await this.r2DataSource.getFolderMeta(key);

    if (Result.isFailure(folderMeta)) {
      yield failAs<Folder>(folderMeta.failure);
      return;
    }

    const folder: Folder = {
      type: 'folder',
      key,
      createdAt: folderMeta.success.createdAt.toISOString(),
      updatedAt: folderMeta.success.updatedAt.toISOString(),
    };

    yield Result.succeed(folder);
  }

  async *getAtom(key: string): AsyncGenerator<LaikaResult<Atom>> {
    // First check if it's a file
    const isFile = await this.r2DataSource.isFile(key);

    if (isFile) {
      yield* this.getObject(key);
      return;
    }

    // Then check if it's a directory
    const isDir = await this.r2DataSource.isDirectory(key);

    if (isDir) {
      yield* this.getFolder(key);
      return;
    }

    yield Result.fail(new BadRequestError(`Path not found: ${key}`));
  }

  async *getObject(key: string): AsyncGenerator<LaikaResult<StorageObject>> {
    const [objectMetaResult, objectContentResult] = await Promise.all([
      this.r2DataSource.getObjectMeta(key),
      this.r2DataSource.getObjectContents(key),
    ]);

    if (Result.isFailure(objectMetaResult)) {
      yield failAs<StorageObject>(objectMetaResult.failure);
      return;
    }
    if (Result.isFailure(objectContentResult)) {
      yield failAs<StorageObject>(objectContentResult.failure);
      return;
    }

    // Use the key without extension from the datasource
    const keyWithoutExt = objectContentResult.success.key;
    const ext = objectContentResult.success.extension;

    const storageObject: StorageObject = {
      type: 'object',
      key: keyWithoutExt,
      createdAt: objectMetaResult.success.createdAt.toISOString(),
      updatedAt: objectMetaResult.success.updatedAt.toISOString(),
      content: await this.deserialize(ext, objectContentResult.success.content),
    };

    yield Result.succeed(storageObject);
  }

  async *updateObject(update: StorageObjectUpdate): AsyncGenerator<LaikaResult<StorageObject>> {
    // First resolve the key to get the actual file extension
    const objectMetaResult = await this.r2DataSource.getObjectMeta(update.key);

    if (Result.isFailure(objectMetaResult)) {
      yield failAs<StorageObject>(objectMetaResult.failure);
      return;
    }

    const ext = objectMetaResult.success.extension;
    const stringified = update.content ? await this.serialize(ext, update.content) : undefined;

    if (stringified) {
      const updateResult = await this.r2DataSource.createOrUpdate(
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
    const existingExt = await this.r2DataSource.findExistingObjectExtension(create.key);

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

    const createResult = await this.r2DataSource.createOrUpdate(
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
    const ext = await this.r2DataSource.findExistingObjectExtension(create.key) || this.defaultFileExtension;

    const createResult = await this.r2DataSource.createOrUpdate(
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
    // Create a .keep file to represent the folder
    const createResult = await this.r2DataSource.createOrUpdate(
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
    return this.getAtomSummariesList(folderKey, options);
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    return this.getFullAtomsList(folderKey, options);
  }

  private async *getAtomSummariesList(
    folderKey: string,
    _options: ListAtomsOptions,
  ): AsyncGenerator<LaikaResult<readonly AtomSummary[]>> {
    const entries = await this.r2DataSource.listDirectory(folderKey);

    if (Result.isFailure(entries)) {
      yield failAs<readonly AtomSummary[]>(entries.failure);
      return;
    }

    const availableExtensions = Object.keys(this.serializerRegistry);

    const filteredEntries = entries.success.filter((entry: { key: string, type: string }) => {
      return this.excludeFilter.every(pattern => !pattern.test(entry.key));
    }).map((entry: { key: string, type: string }) => {
      let key = entry.key;

      // Strip extension from files if it matches an available extension
      if (entry.type === 'file') {
        for (const ext of availableExtensions) {
          if (key.endsWith(`.${ext}`)) {
            key = key.slice(0, -(ext.length + 1));
            break;
          }
        }
      }

      const atomSummary: AtomSummary = {
        type: entry.type === 'file' ? 'object-summary' : 'folder-summary',
        key: key,
      };
      return atomSummary;
    });

    yield Result.succeed(filteredEntries as readonly AtomSummary[]);
  }

  private async *getFullAtomsList(
    folderKey: string,
    _options: ListAtomsOptions,
  ): AsyncGenerator<LaikaResult<readonly Atom[]>> {
    const entries = await this.r2DataSource.listDirectory(folderKey);

    if (Result.isFailure(entries)) {
      yield failAs<readonly Atom[]>(entries.failure);
      return;
    }

    const availableExtensions = Object.keys(this.serializerRegistry);

    const filteredEntries = entries.success.filter((entry: { key: string, type: string }) => {
      return this.excludeFilter.every(pattern => !pattern.test(entry.key));
    }).map((entry: { key: string, type: string }) => {
      let key = entry.key;

      // Strip extension from files if it matches an available extension
      if (entry.type === 'file') {
        for (const ext of availableExtensions) {
          if (key.endsWith(`.${ext}`)) {
            key = key.slice(0, -(ext.length + 1));
            break;
          }
        }
      }

      return {
        type: entry.type === 'file' ? 'object-summary' : 'folder-summary',
        key: key,
      } as AtomSummary;
    });

    const atoms: Atom[] = [];
    for (const entry of filteredEntries) {
      if (entry.type === 'object-summary') {
        for await (const objectResult of this.getObject(entry.key)) {
          if (Result.isSuccess(objectResult)) {
            atoms.push(objectResult.success);
          }
        }
      } else if (entry.type === 'folder-summary') {
        for await (const folderResult of this.getFolder(entry.key)) {
          if (Result.isSuccess(folderResult)) {
            atoms.push(folderResult.success);
          }
        }
      }
    }

    yield Result.succeed(atoms as readonly Atom[]);
  }
}
