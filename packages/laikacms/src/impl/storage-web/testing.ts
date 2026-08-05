// Testkit for WebStorageRepository.
// Uses a real WebStorageRepository + an in-memory Web `Storage` shim as the
// backend — no browser or jsdom required. The shim *is* the test seam: it's
// injected via the `storage` constructor option the same way a real
// `localStorage`/`sessionStorage` would be.
import type { StorageContractCase } from '../../domain/storage/testing/index.js';
import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import { WebStorageRepository } from './infrastructure/repositories/web-storage-repository.js';

/**
 * Minimal in-memory implementation of the Web `Storage` interface
 * (`getItem`/`setItem`/`removeItem`/`key`/`length`/`clear`), suitable for
 * driving `WebStorageRepository` in Node without a DOM.
 */
export class InMemoryWebStorage implements Storage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

export const webStorageContractCase: StorageContractCase = {
  name: 'WebStorageRepository (in-memory Web Storage shim)',
  async makeRepo() {
    const storage = new InMemoryWebStorage();
    return new WebStorageRepository({
      storage,
      serializerRegistry: { json: jsonSerializer },
      defaultExtension: 'json',
    });
  },
};
