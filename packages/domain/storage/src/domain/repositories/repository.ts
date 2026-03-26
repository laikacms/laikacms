import { InvalidData, Result } from '@laikacms/core'

import type {
  Folder,
  Atom,
  FolderCreate,
  StorageObject,
  StorageObjectUpdate,
  AtomSummary,
  Pagination,
  StorageObjectCreate,
} from '../entities/index.js'
import { StorageSerializerRegistry } from '../types/storage-serializer.js'
import { StorageProvider } from '../types/storage-provider.js'
import { AsyncCache } from '../types/cache.js'
import { StorageFormat } from '../types/storage-format.js'

export interface ListAtomsOptions {
  depth: number,
  pagination: Pagination,
}

export abstract class StorageRepository {
  protected readonly cache?: AsyncCache<string, unknown>;

  constructor(
    cache?: AsyncCache<string, unknown>,
  ) {
    this.cache = cache;
  }

  // Storage Objects (formerly Files)
  abstract getObject(key: string): Promise<Result<StorageObject>>
  abstract updateObject(update: StorageObjectUpdate): Promise<Result<StorageObject>>
  abstract createObject(create: StorageObjectCreate): Promise<Result<StorageObject>>
  abstract createOrUpdateObject(create: StorageObjectCreate): Promise<Result<StorageObject>>

  // Folders (formerly Directories)
  abstract getFolder(key: string): Promise<Result<Folder>>
  abstract listAtomSummaries(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly AtomSummary[]>>
  abstract listAtoms(folderKey: string, options: ListAtomsOptions): AsyncGenerator<Result<readonly Atom[]>>
  abstract createFolder(folderCreate: FolderCreate): Promise<Result<Folder>>

  // Atoms (formerly Entries)
  abstract getAtom(key: string): Promise<Result<Atom>>
  abstract removeAtoms(keys: readonly string[]): AsyncGenerator<Result<readonly string[]>>
}
