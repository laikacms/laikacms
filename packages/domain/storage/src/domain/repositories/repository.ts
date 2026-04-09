import { LaikaResult } from '@laikacms/core';

import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  Pagination,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
} from '../entities/index.js';
import { AsyncCache } from '../types/cache.js';
import { Key } from '../types/key.js';

export interface ListAtomsOptions {
  depth: number;
  pagination: Pagination;
}

type ResultStream<T> = AsyncGenerator<LaikaResult<T>>;

export abstract class StorageRepository {
  protected readonly cache?: AsyncCache<string, unknown>;

  constructor(
    cache?: AsyncCache<string, unknown>,
  ) {
    this.cache = cache;
  }

  // Storage Objects (formerly Files)
  abstract getObject(key: Key): ResultStream<StorageObject>;
  abstract updateObject(update: StorageObjectUpdate): ResultStream<StorageObject>;
  abstract createObject(create: StorageObjectCreate): ResultStream<StorageObject>;
  abstract createOrUpdateObject(create: StorageObjectCreate): ResultStream<StorageObject>;

  // Folders (formerly Directories)
  abstract getFolder(key: Key): ResultStream<Folder>;
  abstract listAtomSummaries(folderKey: Key, options: ListAtomsOptions): ResultStream<readonly AtomSummary[]>;
  abstract listAtoms(folderKey: Key, options: ListAtomsOptions): ResultStream<readonly Atom[]>;
  abstract createFolder(folderCreate: FolderCreate): ResultStream<Folder>;

  // Atoms (formerly Entries)
  abstract getAtom(key: Key): ResultStream<Atom>;
  abstract removeAtoms(keys: readonly Key[]): ResultStream<readonly Key[]>;
}
