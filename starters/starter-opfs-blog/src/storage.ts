/**
 * Storage-root selection and repository wiring — the heart of this starter.
 *
 * Content lives behind a `WebFsStorageRepository` (`laikacms/storage/web-fs`),
 * which accepts any `FileSystemDirectoryHandle`. This module decides which
 * handle that is:
 *
 *   - `'opfs'`  — the origin-private file system (`navigator.storage.getDirectory()`).
 *     Works in every modern browser; invisible to the user's real file system.
 *   - `'local'` — a real on-disk folder picked via `showDirectoryPicker()`
 *     (Chromium only). The handle is structured-cloneable, so it is persisted
 *     in IndexedDB and survives reloads — subject to the browser re-prompting
 *     for permission, which the repository surfaces as typed errors
 *     (`PermissionPromptRequiredError` / `StaleHandleError`) and this module
 *     helps recover from.
 *
 * On top of the storage repository sit the same Catalog adapters the
 * server-side stack uses (`@laikacms/vite-plugin` wires them identically):
 * documents for entries, assets for media.
 */
import { CatalogAssetsRepository } from 'laikacms/assets/catalog';
import { ConventionCatalogProvider } from 'laikacms/catalog-convention';
import { CatalogDocumentsRepository } from 'laikacms/documents/catalog';
import { jsonSerializer } from 'laikacms/serializers/json';
import { markdownSerializer } from 'laikacms/serializers/markdown';
import { rawSerializer } from 'laikacms/serializers/raw';
import { yamlSerializer } from 'laikacms/serializers/yaml';
import type { StorageRepository } from 'laikacms/storage';
import { WebFsStorageRepository } from 'laikacms/storage/web-fs';

export type StorageMode = 'opfs' | 'local';

const MODE_KEY = 'laika-starter-storage-mode';
const IDB_NAME = 'laika-starter-opfs-blog';
const IDB_STORE = 'handles';
const IDB_ROOT_KEY = 'root';

/** `showDirectoryPicker` only ships in Chromium-based browsers. */
export const supportsLocalFolders = typeof window !== 'undefined'
  && typeof window.showDirectoryPicker === 'function';

export function currentMode(): StorageMode {
  return localStorage.getItem(MODE_KEY) === 'local' ? 'local' : 'opfs';
}

// ---------------------------------------------------------------------------
// IndexedDB persistence for the picked directory handle
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(IDB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbRequest<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export function loadLocalHandle(): Promise<FileSystemDirectoryHandle | undefined> {
  return idbRequest('readonly', store => store.get(IDB_ROOT_KEY));
}

// ---------------------------------------------------------------------------
// Mode switching (all three must be called from a user gesture where noted)
// ---------------------------------------------------------------------------

/** Switch to the origin-private file system. The stored local handle is kept. */
export function useOpfs(): void {
  localStorage.setItem(MODE_KEY, 'opfs');
}

/**
 * Pick an on-disk folder and switch to it. Must be called from a user gesture
 * (`showDirectoryPicker` requires one). Resolves `false` when the user
 * cancels the picker.
 */
export async function pickLocalFolder(): Promise<boolean> {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser does not support picking a local folder (Chromium only).');
  }
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: 'laika-starter-content', mode: 'readwrite' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return false;
    throw error;
  }
  await idbRequest('readwrite', store => store.put(handle, IDB_ROOT_KEY));
  localStorage.setItem(MODE_KEY, 'local');
  return true;
}

/**
 * Permission status of the stored local handle:
 * `'no-handle'` means nothing was ever picked (or the record was cleared).
 */
export async function localAccessState(): Promise<PermissionState | 'no-handle'> {
  const handle = await loadLocalHandle();
  if (!handle) return 'no-handle';
  return handle.queryPermission?.({ mode: 'readwrite' }) ?? 'granted';
}

/**
 * Re-request access to the stored local handle after the browser dropped the
 * grant back to `'prompt'` — the recovery for `PermissionPromptRequiredError`.
 * Must be called from a user gesture.
 */
export async function requestLocalAccess(): Promise<PermissionState> {
  const handle = await loadLocalHandle();
  if (!handle) return 'denied';
  return handle.requestPermission?.({ mode: 'readwrite' }) ?? 'granted';
}

// ---------------------------------------------------------------------------
// Repositories
// ---------------------------------------------------------------------------

export interface Repositories {
  storage: StorageRepository,
  documents: CatalogDocumentsRepository,
  assets: CatalogAssetsRepository,
}

/**
 * Resolve the root handle for the current mode. Passed to the repository as a
 * provider so it is re-evaluated lazily — the repository validates permission
 * and liveness on every operation anyway.
 */
async function resolveRoot(): Promise<FileSystemDirectoryHandle> {
  if (currentMode() === 'local') {
    const handle = await loadLocalHandle();
    if (!handle) {
      throw new Error('No local folder picked yet — choose one from the storage bar.');
    }
    return handle;
  }
  return navigator.storage.getDirectory();
}

let repositories: Repositories | undefined;

/**
 * The repositories for the currently selected root. Memoized per page load;
 * switching modes reloads the page, so a stale root never leaks.
 */
export function getRepositories(): Repositories {
  if (!repositories) {
    const storage = new WebFsStorageRepository({
      root: resolveRoot,
      // The user picks (or the origin owns) a folder dedicated to this blog,
      // so content lands at its top level (`posts/…`, `uploads/…`) instead of
      // under the default `laikacms/` namespace subdirectory. Set a namespace
      // if the folder is shared with unrelated data.
      namespace: '',
      serializerRegistry: {
        json: jsonSerializer,
        markdown: markdownSerializer,
        md: markdownSerializer,
        mdx: markdownSerializer,
        yaml: yamlSerializer,
        yml: yamlSerializer,
        raw: rawSerializer,
      },
      defaultExtension: 'json',
    });
    const settings = new ConventionCatalogProvider({ storage });
    repositories = {
      storage,
      documents: new CatalogDocumentsRepository(storage, settings),
      assets: new CatalogAssetsRepository(storage, settings),
    };
  }
  return repositories;
}
