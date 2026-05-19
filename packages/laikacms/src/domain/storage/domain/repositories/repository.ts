import type { LaikaDone, LaikaStream, LaikaTask, Pagination } from 'laikacms/core';

import type { Capabilities } from '../entities/capabilities.js';
import type {
  Atom,
  AtomSummary,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
} from '../entities/index.js';
import type { Key } from '../types/key.js';

export interface ListAtomsOptions {
  depth: number;
  pagination: Pagination;
}

/**
 * Done value returned by `listAtoms` / `listAtomSummaries`. Pagination on the
 * base lets HTTP layers wire JSON:API `links.next` / `meta.total` without
 * per-method special cases.
 */
export type ListAtomsDone = LaikaDone;

/**
 * Done value returned by `removeAtoms`. Per-key removal failures are surfaced
 * as stream warnings (typically NotFoundError); the done value reports counts.
 */
export interface RemoveAtomsDone extends LaikaDone {
  readonly removed: number;
  readonly skipped: number;
}

export abstract class StorageRepository {
  // Storage Objects (formerly Files)
  abstract getObject(key: Key): LaikaTask.LaikaTask<StorageObject>;
  abstract updateObject(update: StorageObjectUpdate): LaikaTask.LaikaTask<StorageObject>;
  abstract createObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject>;
  abstract createOrUpdateObject(create: StorageObjectCreate): LaikaTask.LaikaTask<StorageObject>;

  // Folders (formerly Directories)
  abstract getFolder(key: Key): LaikaTask.LaikaTask<Folder>;
  abstract listAtomSummaries(
    folderKey: Key,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<AtomSummary, ListAtomsDone>;
  abstract listAtoms(
    folderKey: Key,
    options: ListAtomsOptions,
  ): LaikaStream.LaikaStream<Atom, ListAtomsDone>;
  abstract createFolder(folderCreate: FolderCreate): LaikaTask.LaikaTask<Folder>;

  // Atoms (formerly Entries)
  abstract getAtom(key: Key): LaikaTask.LaikaTask<Atom>;
  abstract removeAtoms(keys: readonly Key[]): LaikaStream.LaikaStream<Key, RemoveAtomsDone>;

  // Other
  abstract getCapabilities(): LaikaTask.LaikaTask<Capabilities>;
}
