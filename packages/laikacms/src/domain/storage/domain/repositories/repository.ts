import type { LaikaDone, LaikaStream, LaikaTask, Pagination } from 'laikacms/core';
import { NotImplementedError } from 'laikacms/core';

import type { Capabilities } from '../entities/capabilities.js';
import type {
  Atom,
  AtomSummary,
  ChangeListener,
  Folder,
  FolderCreate,
  StorageObject,
  StorageObjectCreate,
  StorageObjectUpdate,
  SubscribeChangesOptions,
  Unsubscribe,
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

  // Change signals (capability-gated; see Capabilities.changes)

  /**
   * Subscribe to live change notifications for a scope (a folder, or the whole
   * store when omitted). `listener` is invoked with a coalesced, non-empty
   * batch of {@link ChangeSummary} entries each time the scope changes. Returns
   * an {@link Unsubscribe} that stops delivery; when the last listener leaves,
   * the repository releases any underlying watch resource.
   *
   * This is the PUSH counterpart to the pull `getSyncToken` / `listChanges`
   * feed. Non-abstract on purpose: existing subclasses stay source-compatible.
   * The base implementation throws `NotImplementedError`; check
   * `getCapabilities().changes` (the enabled variant's `subscription` flag)
   * before calling.
   */
  subscribeChanges(options: SubscribeChangesOptions, listener: ChangeListener): Unsubscribe {
    void options;
    void listener;
    throw new NotImplementedError(
      'subscribeChanges is not supported by this storage repository. '
        + 'Consult getCapabilities().changes.subscription before calling.',
    );
  }
}
