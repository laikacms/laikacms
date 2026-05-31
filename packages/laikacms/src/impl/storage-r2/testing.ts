import { type StorageContractCase, storageContractRegistry } from '../../domain/storage/testing/index.js';
import { jsonSerializer } from '../../serializers/storage-serializers-json/index.js';

import { R2StorageRepository } from './infrastructure/repositories/r2-storage-repository.js';

interface StoredObject {
  key: string;
  body: string;
  uploaded: Date;
  etag: string;
}

let etagCounter = 0;

class InMemoryR2Bucket {
  readonly store = new Map<string, StoredObject>();

  async head(key: string) {
    const obj = this.store.get(key);
    if (!obj) return null;
    return { size: obj.body.length, uploaded: obj.uploaded, etag: obj.etag };
  }

  async get(key: string) {
    const obj = this.store.get(key);
    if (!obj) return null;
    return {
      size: obj.body.length,
      uploaded: obj.uploaded,
      etag: obj.etag,
      text: async () => obj.body,
    };
  }

  async put(key: string, body: string) {
    this.store.set(key, {
      key,
      body,
      uploaded: new Date(),
      etag: `etag-${++etagCounter}`,
    });
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  async list(opts: { prefix?: string, delimiter?: string, cursor?: string, limit?: number }) {
    const prefix = opts.prefix ?? '';
    const delimiter = opts.delimiter;
    const limit = opts.limit ?? 1000;

    const matching = Array.from(this.store.values())
      .filter(o => o.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const startIdx = opts.cursor
      ? matching.findIndex(o => o.key === opts.cursor)
      : 0;
    const sliceStart = startIdx === -1 ? matching.length : startIdx;

    const objects: { key: string, size: number, uploaded: Date, etag: string }[] = [];
    const delimitedPrefixSet = new Set<string>();

    let i = sliceStart;
    for (; i < matching.length && objects.length < limit; i++) {
      const o = matching[i];
      if (delimiter) {
        const tail = o.key.slice(prefix.length);
        const sepIdx = tail.indexOf(delimiter);
        if (sepIdx !== -1) {
          delimitedPrefixSet.add(prefix + tail.slice(0, sepIdx + delimiter.length));
          continue;
        }
      }
      objects.push({ key: o.key, size: o.body.length, uploaded: o.uploaded, etag: o.etag });
    }

    const truncated = i < matching.length;
    return {
      objects,
      delimitedPrefixes: Array.from(delimitedPrefixSet).sort(),
      truncated,
      cursor: truncated ? matching[i].key : undefined,
    };
  }
}

export const r2StorageContractCase: StorageContractCase = {
  name: 'R2StorageRepository (in-memory R2 stub)',
  makeRepo: async () => {
    const bucket = new InMemoryR2Bucket();
    return new R2StorageRepository(bucket as unknown as R2Bucket, { json: jsonSerializer }, 'json');
  },
  /**
   * R2's `delete` is idempotent — it succeeds whether or not the key existed —
   * so this impl can't distinguish removed-vs-skipped from R2 alone. The
   * "removes keys" half passes on its own but ships paired with the
   * "skipped > 0" half under the same capability, so we skip both.
   */
  skip: ['removeAtoms'],
};

storageContractRegistry.push(r2StorageContractCase);
