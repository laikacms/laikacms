import { BadRequestError, EntryAlreadyExistsError, failure, InvalidData, Result, success } from '@laikacms/core';
import { 
  Folder, 
  FolderCreate, 
  Atom, 
  StorageRepository, 
  AtomSummary, 
  StorageObject, 
  StorageObjectContent, 
  StorageObjectUpdate, 
  ListAtomsOptions, 
  pathCombine, 
  StorageObjectCreate, 
  StorageSerializerRegistry 
} from '@laikacms/storage';
import * as minimatch from 'minimatch';
import { R2DataSource } from '../datasources/r2-datasource.js';

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
      '**/.laikacms'
    ],
  ) {
    super();
    const availableExtensions = Object.keys(this.serializerRegistry);
    this.r2DataSource = new R2DataSource(bucket, availableExtensions, defaultFileExtension);
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
    const result = await this.r2DataSource.deleteObjects(keys);

    if (result.success) {
      yield success(result.data as readonly string[], [...result.messages]);
    } else {
      yield result;
    }
  }

  getFolder = async (
    key: string
  ): Promise<Result<Folder>> => {
    const folderMeta = await this.r2DataSource.getFolderMeta(key);

    if (!folderMeta.success) return folderMeta;

    const folder: Folder = {
      type: 'folder',
      key,
      createdAt: folderMeta.data.createdAt.toISOString(),
      updatedAt: folderMeta.data.updatedAt.toISOString(),
    };

    return success(folder);
  };

  async getAtom(key: string): Promise<Result<Atom>> {
    // First check if it's a file
    const isFile = await this.r2DataSource.isFile(key);
    
    if (isFile) {
      return this.getObject(key);
    }
    
    // Then check if it's a directory
    const isDir = await this.r2DataSource.isDirectory(key);
    
    if (isDir) {
      return this.getFolder(key);
    }
    
    throw new BadRequestError(`Path not found: ${key}`);
  }

  async getObject(key: string): Promise<Result<StorageObject>> {
    const [objectMetaResult, objectContentResult] = await Promise.all([
      this.r2DataSource.getObjectMeta(key),
      this.r2DataSource.getObjectContents(key),
    ]);

    if (!objectMetaResult.success) return objectMetaResult;
    if (!objectContentResult.success) return objectContentResult;

    // Use the key without extension from the datasource
    const keyWithoutExt = objectContentResult.data.key;
    const ext = objectContentResult.data.extension;

    const storageObject: StorageObject = {
      type: 'object',
      key: keyWithoutExt,
      createdAt: objectMetaResult.data.createdAt.toISOString(),
      updatedAt: objectMetaResult.data.updatedAt.toISOString(),
      content: await this.deserialize(ext, objectContentResult.data.content)
    };

    return success(storageObject);
  }

  async updateObject(update: StorageObjectUpdate): Promise<Result<StorageObject>> {
    // First resolve the key to get the actual file extension
    const objectMetaResult = await this.r2DataSource.getObjectMeta(update.key);
    
    if (!objectMetaResult.success) return objectMetaResult;
    
    const ext = objectMetaResult.data.extension;
    const stringified = update.content ? await this.serialize(ext, update.content) : undefined;

    if (stringified) {
      const updateResult = await this.r2DataSource.createOrUpdate(
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
    const existingExt = await this.r2DataSource.findExistingObjectExtension(create.key);
    
    if (existingExt) {
      return failure(
        EntryAlreadyExistsError.CODE,
        [`An object with key "${create.key}" already exists with extension .${existingExt}`]
      );
    }
    
    // Use the default file extension for new objects
    const ext = this.defaultFileExtension;
    const stringified = await this.serialize(ext, create.content);

    const createResult = await this.r2DataSource.createOrUpdate(
      create.key,
      stringified,
      ext
    );

    if (!createResult.success) return createResult;

    return this.getObject(create.key);
  }

  async createOrUpdateObject(create: StorageObjectCreate): Promise<Result<StorageObject>> {
    const ext = await this.r2DataSource.findExistingObjectExtension(create.key) || this.defaultFileExtension;
    
    await this.r2DataSource.createOrUpdate(
      create.key,
      create.content ? await this.serialize(ext, create.content) : '',
      ext
    );
    
    return await this.getObject(create.key);
  }

  async createFolder(folderCreate: FolderCreate): Promise<Result<Folder>> {
    // Create a .keep file to represent the folder
    const createResult = await this.r2DataSource.createOrUpdate(
      pathCombine(folderCreate.key, '.keep'),
      '',
      '' // .keep files don't need an extension
    );

    if (!createResult.success) return createResult;

    return this.getFolder(folderCreate.key);
  }

  listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly AtomSummary[]>> {
    return this.getAtomSummariesList(folderKey, options);
  }

  listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly Atom[]>> {
    return this.getFullAtomsList(folderKey, options);
  }

  private async *getAtomSummariesList(
    folderKey: string,
    _options: ListAtomsOptions
  ): AsyncGenerator<Result<readonly AtomSummary[]>> {
    const entries = await this.r2DataSource.listDirectory(folderKey);

    if (!entries.success) {
      yield entries;
      return;
    }

    const availableExtensions = Object.keys(this.serializerRegistry);
    
    const filteredEntries = entries.data.filter((entry: { key: string; type: string }) => {
      return this.excludeFilter.every((pattern) => !pattern.test(entry.key));
    }).map((entry: { key: string; type: string }) => {
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

    yield success(filteredEntries as readonly AtomSummary[]);
  }

  private async *getFullAtomsList(
    folderKey: string,
    _options: ListAtomsOptions
  ): AsyncGenerator<Result<readonly Atom[]>> {
    const entries = await this.r2DataSource.listDirectory(folderKey);

    if (!entries.success) {
      yield entries;
      return;
    }

    const availableExtensions = Object.keys(this.serializerRegistry);
    
    const filteredEntries = entries.data.filter((entry: { key: string; type: string }) => {
      return this.excludeFilter.every((pattern) => !pattern.test(entry.key));
    }).map((entry: { key: string; type: string }) => {
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
        const objectResult = await this.getObject(entry.key);
        if (objectResult.success) {
          atoms.push(objectResult.data);
        }
      } else if (entry.type === 'folder-summary') {
        const folderResult = await this.getFolder(entry.key);
        if (folderResult.success) {
          atoms.push(folderResult.data);
        }
      }
    }
    
    yield success(atoms as readonly Atom[]);
  }
}
