// Testkit for WebFsStorageRepository.
// Uses a real WebFsStorageRepository + an in-memory directory-handle shim as
// the backend — no browser required. The shim *is* the test seam: it's
// injected via the `root` constructor option the same way a real
// `FileSystemDirectoryHandle` would be.
import type { StorageContractCase } from '../../domain/storage/testing/index.js';
import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import type {
  WebFsAccessMode,
  WebFsDirectoryHandle,
  WebFsFileHandle,
  WebFsFileSnapshot,
  WebFsPermissionState,
  WebFsWritableStream,
} from './domain/types/web-fs-handles.js';
import { WebFsStorageRepository } from './infrastructure/repositories/web-fs-storage-repository.js';

/**
 * Minimal in-memory implementation of the {@link WebFsFileHandle} contract,
 * matching real File System API semantics: `createWritable` buffers and the
 * content is only committed (and `lastModified` bumped) at `close`.
 */
export class InMemoryWebFsFileHandle implements WebFsFileHandle {
  readonly kind = 'file' as const;
  private contents = '';
  private lastModified = Date.now();

  constructor(readonly name: string) {}

  async getFile(): Promise<WebFsFileSnapshot> {
    const { contents, lastModified } = this;
    return { lastModified, text: async () => contents };
  }

  async createWritable(): Promise<WebFsWritableStream> {
    let buffer = '';
    return {
      write: async (data: string) => {
        buffer += data;
      },
      close: async () => {
        this.contents = buffer;
        this.lastModified = Date.now();
      },
    };
  }
}

/**
 * Minimal in-memory implementation of the {@link WebFsDirectoryHandle}
 * contract, suitable for driving `WebFsStorageRepository` in Node without a
 * browser. Error behaviour mirrors the real API: missing entries throw
 * `NotFoundError` `DOMException`s, kind mismatches throw `TypeMismatchError`,
 * and removing a non-empty directory without `recursive` throws
 * `InvalidModificationError`.
 */
export class InMemoryWebFsDirectoryHandle implements WebFsDirectoryHandle {
  readonly kind = 'directory' as const;
  private readonly children = new Map<string, InMemoryWebFsDirectoryHandle | InMemoryWebFsFileHandle>();

  constructor(readonly name: string = '') {}

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WebFsDirectoryHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'directory') {
        throw new DOMException(`${name} is not a directory`, 'TypeMismatchError');
      }
      return existing;
    }
    if (!options?.create) throw new DOMException(`${name} does not exist`, 'NotFoundError');
    const dir = new InMemoryWebFsDirectoryHandle(name);
    this.children.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<WebFsFileHandle> {
    const existing = this.children.get(name);
    if (existing) {
      if (existing.kind !== 'file') {
        throw new DOMException(`${name} is not a file`, 'TypeMismatchError');
      }
      return existing;
    }
    if (!options?.create) throw new DOMException(`${name} does not exist`, 'NotFoundError');
    const file = new InMemoryWebFsFileHandle(name);
    this.children.set(name, file);
    return file;
  }

  async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    const existing = this.children.get(name);
    if (!existing) throw new DOMException(`${name} does not exist`, 'NotFoundError');
    if (existing.kind === 'directory' && existing.children.size > 0 && !options?.recursive) {
      throw new DOMException(`${name} is not empty`, 'InvalidModificationError');
    }
    this.children.delete(name);
  }

  async *entries(): AsyncIterableIterator<[string, WebFsDirectoryHandle | WebFsFileHandle]> {
    yield* this.children.entries();
  }
}

/**
 * A picked-directory-style root: the same in-memory tree as
 * {@link InMemoryWebFsDirectoryHandle}, plus the permission and lifecycle
 * failure modes a `showDirectoryPicker()` handle can exhibit when reused
 * later. Toggle {@link permissionState} or call {@link disconnect} between
 * operations to drive the `PermissionDeniedError` paths.
 *
 * The base class deliberately has no `queryPermission` — it models handles
 * that can't be asked (origin-private roots), which the repository treats as
 * granted.
 */
export class InMemoryPickedDirectoryHandle extends InMemoryWebFsDirectoryHandle {
  /** Returned verbatim by `queryPermission`; mutate freely between operations. */
  permissionState: WebFsPermissionState = 'granted';
  /** Records the descriptors `queryPermission` was called with. */
  readonly permissionQueries: Array<{ mode: WebFsAccessMode }> = [];
  private stale = false;

  async queryPermission(descriptor: { mode: WebFsAccessMode }): Promise<WebFsPermissionState> {
    this.permissionQueries.push(descriptor);
    return this.permissionState;
  }

  /**
   * Models a handle whose underlying directory was deleted/moved or whose
   * persisted handle expired: every subsequent member throws the same
   * `NotFoundError` `DOMException` the real API produces.
   */
  disconnect(): void {
    this.stale = true;
  }

  private assertConnected(): void {
    if (this.stale) {
      throw new DOMException('The underlying directory no longer exists', 'NotFoundError');
    }
  }

  override async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<WebFsDirectoryHandle> {
    this.assertConnected();
    return super.getDirectoryHandle(name, options);
  }

  override async getFileHandle(name: string, options?: { create?: boolean }): Promise<WebFsFileHandle> {
    this.assertConnected();
    return super.getFileHandle(name, options);
  }

  override async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
    this.assertConnected();
    return super.removeEntry(name, options);
  }

  override async *entries(): AsyncIterableIterator<[string, WebFsDirectoryHandle | WebFsFileHandle]> {
    // Throw before yielding anything, so even a first-entry probe trips.
    this.assertConnected();
    yield* super.entries();
  }
}

export const webFsStorageContractCase: StorageContractCase = {
  name: 'WebFsStorageRepository (in-memory directory-handle shim)',
  async makeRepo() {
    return new WebFsStorageRepository({
      root: new InMemoryWebFsDirectoryHandle(),
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
    });
  },
};
