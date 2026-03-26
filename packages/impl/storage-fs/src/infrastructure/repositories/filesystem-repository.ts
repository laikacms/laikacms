import { BadRequestError, EntryAlreadyExistsError, failure, InvalidData, Result, success } from '@laikacms/core';
import { Folder, FolderCreate, Atom, StorageRepository, AtomSummary, StorageObject, StorageObjectContent, StorageObjectUpdate, ListAtomsOptions, pathCombine, StorageObjectCreate, StorageSerializerRegistry, extension } from '@laikacms/storage';
import * as minimatch from 'minimatch';
import { FileSystemDataSource } from '../datasources/filesystem-datasource.js';

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
      '**/.laikacms'
    ],
  ) {
    super();
    const availableExtensions = Object.keys(this.serializerRegistry);
    this.fileSystemDataSource = new FileSystemDataSource(availableExtensions, defaultFileExtension);
    this.excludeFilter = this.ignoreList.map((pattern) =>
      minimatch.makeRe(pattern, { dot: true, partial: true })
    ).filter(x => x !== false);
  }

  /**
   * Serialize StorageObjectContent to string based on file extension
   */
  private async serialize(ext: string, content: StorageObjectContent): Promise<string> {
    ext.startsWith('.') && (ext = ext.slice(1));
    const serializer = this.serializerRegistry[ext];
    
    if (!serializer) {
      throw new BadRequestError(
        `No serializer found for file extension: .${ext}. ` +
        `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`
      );
    }

    try {
      return await serializer.serializeDocumentFileContents(content, {});
    } catch (error) {
      console.error(error);
      throw new BadRequestError(
        `Failed to serialize content: ${error instanceof Error ? error.message : String(error)}`
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
        `No serializer found for file extension: .${ext}. ` +
        `Available formats: ${Object.keys(this.serializerRegistry).join(', ')}`
      );
    }

    try {
      return await serializer.deserializeDocumentFileContents(content, {});
    } catch (error) {
      console.error(error);
      throw new BadRequestError(
        `Failed to deserialize content: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async *removeAtoms(
    keys: readonly string[]
  ): AsyncGenerator<Result<readonly string[]>> {
  
    const dirSubToAtomMapping = new Map<string, string>();

    const result = await this.fileSystemDataSource.deleteEntries(
      this.rootDirectory,
      keys.map(path => ({ path, type: 'file' }))
    );

    if (result.success) {
      const resultAtoms = result.data
        .map((dirSub) => dirSubToAtomMapping.get(dirSub.path))
        .filter(Boolean) as readonly string[];
      return success(resultAtoms, [...result.messages]);
    } else {
      return result;
    }
  };

  getFolder = async (
    key: string
  ): Promise<Result<Folder>> => {

    const dirSubs = await this.fileSystemDataSource.getDirMeta(
      this.rootDirectory,
      key
    );

    if (!dirSubs.success) return dirSubs;

    const folder: Folder = {
      type: 'folder',
      key,
      createdAt: dirSubs.data.createdAt.toISOString(),
      updatedAt: dirSubs.data.updatedAt.toISOString(),
    };

    return success(folder);
  };

  async getAtom(key: string): Promise<Result<Atom>> {
    const isDir = await this.fileSystemDataSource.isDir(
      this.rootDirectory,
      key
    )

    const type = isDir
      ? 'dir'
      : 'file';

    if (type === 'file') return this.getObject(key);
    else if (type === 'dir')
      return this.getFolder(key);
    else throw new BadRequestError('Invalid type: ' + type);
  };

  async getObject(key: string): Promise<Result<StorageObject>> {
    const [fileMetaResult, fileContentResult] = await Promise.all([
      this.fileSystemDataSource.getFileMeta(
        this.rootDirectory,
        key
      ),
      this.fileSystemDataSource.getFileContents(
        this.rootDirectory,
        key
      ),
    ]);

    if (!fileMetaResult.success) return fileMetaResult;
    if (!fileContentResult.success) return fileContentResult;

    // Use the path without extension from the datasource
    const keyWithoutExt = fileContentResult.data.path;
    const ext = fileContentResult.data.extension;

    const storageObject: StorageObject = {
      type: 'object',
      key: keyWithoutExt,
      createdAt: fileMetaResult.data.createdAt.toISOString(),
      updatedAt: fileMetaResult.data.updatedAt.toISOString(),
      content: await this.deserialize(ext, fileContentResult.data.content)
    };

    return success(storageObject);
  }

  async updateObject(update: StorageObjectUpdate): Promise<Result<StorageObject>> {
    // First resolve the key to get the actual file extension
    const fileMetaResult = await this.fileSystemDataSource.getFileMeta(
      this.rootDirectory,
      update.key
    );
    
    if (!fileMetaResult.success) return fileMetaResult;
    
    const ext = fileMetaResult.data.extension;
    const stringified = update.content ? await this.serialize(ext, update.content) : undefined;

    if (stringified) {
      const updateResult = await this.fileSystemDataSource.createOrUpdate(
        this.rootDirectory,
        update.key,
        stringified,
        ext
      );
      if (!updateResult.success) return updateResult;
    }

    return this.getObject(update.key);
  }

  async createObject(create: StorageObjectCreate): Promise<Result<StorageObject>> {
    if (!create.content) {
      return failure(InvalidData.CODE, ['Object content is required for creation']);
    }
    
    // Check if an object with this key already exists with any available extension
    const existingExt = await this.fileSystemDataSource.findExistingFileExtension(
      this.rootDirectory,
      create.key
    );
    
    if (existingExt) {
      return failure(
        EntryAlreadyExistsError.CODE,
        [`An object with key "${create.key}" already exists with extension .${existingExt}`]
      );
    }
    
    // Use the default file extension for new objects
    const ext = this.defaultFileExtension;
    const stringified = await this.serialize(ext, create.content);

    const createResult = await this.fileSystemDataSource.createOrUpdate(
      this.rootDirectory,
      create.key,
      stringified,
      ext
    );

    if (!createResult.success) return createResult;

    return this.getObject(create.key);
  }

  async createOrUpdateObject(create: StorageObjectCreate): Promise<Result<StorageObject>> {
    const ext = await this.fileSystemDataSource.findExistingFileExtension(
      this.rootDirectory,
      create.key
    ) || this.defaultFileExtension;
    await this.fileSystemDataSource.createOrUpdate(
      this.rootDirectory,
      create.key,
      create.content ? await this.serialize(ext, create.content) : '',
      ext
    );
    return await this.getObject(create.key);
  }

  async createFolder(folderCreate: FolderCreate): Promise<Result<Folder>> {
    const createResult = await this.fileSystemDataSource.createOrUpdate(
      this.rootDirectory,
      pathCombine(folderCreate.key, '.keep'),
      '',
      '' // .keep files don't need an extension
    );

    if (!createResult.success) return createResult;

    return this.getFolder(folderCreate.key);
  }

  listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly AtomSummary[]>> {
    return this.getAtomsList<AtomSummary>(folderKey, options, true);
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly Atom[]>> {
    return this.getAtomsList<Atom>(folderKey, options, false);
  }

  private async *getAtomsList<T extends AtomSummary | Atom>(folderKey: string, options: ListAtomsOptions, summariesOnly: T extends AtomSummary ? true : false): AsyncGenerator<Result<readonly T[]>> {
    const dirSubs = await this.fileSystemDataSource.listFileSystemDirectory(
      this.rootDirectory,
      folderKey,
    );

    if (!dirSubs.success) return yield dirSubs;

    const availableExtensions = Object.keys(this.serializerRegistry);
    
    const filteredDirSubs = dirSubs.data.filter(dirSub => {
      return this.excludeFilter.every((pattern) => !pattern.test(dirSub.path))
    }).map(dirSub => {
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
      return yield success(filteredDirSubs as unknown as readonly T[]);
    }

    const atoms: T[] = [];
    for (const dirSub of filteredDirSubs) {
      if (dirSub.type === 'object-summary') {
        const objectResult = await this.getObject(dirSub.key);
        if (objectResult.success) {
          atoms.push(objectResult.data as unknown as T);
        }
      } else if (dirSub.type === 'folder-summary') {
        const folderResult = await this.getFolder(dirSub.key);
        if (folderResult.success) {
          atoms.push(folderResult.data as unknown as T);
        }
      }
    }
  }
}
