import { type AssetsContractCase, assetsContractRegistry } from '../../domain/assets/testing/index.js';

import { R2AssetsRepository } from './infrastructure/repositories/r2-assets-repository.js';

interface StoredAsset {
  key: string;
  body: Uint8Array;
  uploaded: Date;
  etag: string;
  httpMetadata?: { contentType?: string, cacheControl?: string };
  customMetadata?: Record<string, string>;
}

const toUint8Array = async (
  body: unknown,
): Promise<Uint8Array> => {
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body && typeof (body as { getReader?: () => unknown }).getReader === 'function') {
    const chunks: Uint8Array[] = [];
    const reader = (body as ReadableStream<Uint8Array>).getReader();
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        total += value.byteLength;
      }
    }
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.byteLength;
    }
    return out;
  }
  if (ArrayBuffer.isView(body)) {
    const v = body as ArrayBufferView;
    return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  }
  return new Uint8Array(0);
};

let etagCounter = 0;

class InMemoryR2AssetsBucket {
  readonly store = new Map<string, StoredAsset>();

  private toR2Object(asset: StoredAsset) {
    return {
      key: asset.key,
      size: asset.body.byteLength,
      etag: asset.etag,
      uploaded: asset.uploaded,
      httpMetadata: asset.httpMetadata,
      customMetadata: asset.customMetadata,
      arrayBuffer: async () =>
        asset.body.buffer.slice(asset.body.byteOffset, asset.body.byteOffset + asset.body.byteLength),
      get body() {
        return new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(asset.body);
            controller.close();
          },
        });
      },
      text: async () => new TextDecoder().decode(asset.body),
    };
  }

  async head(key: string) {
    const a = this.store.get(key);
    if (!a) return null;
    const o = this.toR2Object(a);
    return {
      size: o.size,
      etag: o.etag,
      uploaded: o.uploaded,
      httpMetadata: o.httpMetadata,
      customMetadata: o.customMetadata,
    };
  }

  async get(key: string) {
    const a = this.store.get(key);
    if (!a) return null;
    return this.toR2Object(a);
  }

  async put(
    key: string,
    body: unknown,
    options?: {
      httpMetadata?: { contentType?: string, cacheControl?: string },
      customMetadata?: Record<string, string>,
    },
  ) {
    const bytes = await toUint8Array(body);
    const stored: StoredAsset = {
      key,
      body: bytes,
      uploaded: new Date(),
      etag: `etag-${++etagCounter}`,
      httpMetadata: options?.httpMetadata,
      customMetadata: options?.customMetadata,
    };
    this.store.set(key, stored);
    const o = this.toR2Object(stored);
    return {
      key: o.key,
      size: o.size,
      etag: o.etag,
      uploaded: o.uploaded,
      httpMetadata: o.httpMetadata,
      customMetadata: o.customMetadata,
    };
  }

  async delete(key: string | string[]) {
    if (Array.isArray(key)) {
      for (const k of key) this.store.delete(k);
    } else {
      this.store.delete(key);
    }
  }

  async list(opts: {
    prefix?: string,
    delimiter?: string,
    cursor?: string,
    limit?: number,
    include?: string[],
  }) {
    const prefix = opts.prefix ?? '';
    const delimiter = opts.delimiter;
    const limit = opts.limit ?? 1000;

    const matching = Array.from(this.store.values())
      .filter(a => a.key.startsWith(prefix))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const startIdx = opts.cursor
      ? matching.findIndex(a => a.key === opts.cursor)
      : 0;
    const sliceStart = startIdx === -1 ? matching.length : startIdx;

    const objects: Array<ReturnType<InMemoryR2AssetsBucket['toR2Object']>> = [];
    const delimitedPrefixSet = new Set<string>();

    let i = sliceStart;
    for (; i < matching.length && objects.length < limit; i++) {
      const a = matching[i]!;
      if (delimiter) {
        const tail = a.key.slice(prefix.length);
        const sepIdx = tail.indexOf(delimiter);
        if (sepIdx !== -1) {
          delimitedPrefixSet.add(prefix + tail.slice(0, sepIdx + delimiter.length));
          continue;
        }
      }
      objects.push(this.toR2Object(a));
    }

    const truncated = i < matching.length;
    return {
      objects: objects.map(o => ({
        key: o.key,
        size: o.size,
        etag: o.etag,
        uploaded: o.uploaded,
        httpMetadata: o.httpMetadata,
        customMetadata: o.customMetadata,
      })),
      delimitedPrefixes: Array.from(delimitedPrefixSet).sort(),
      truncated,
      cursor: truncated ? matching[i]!.key : undefined,
    };
  }
}

export const r2AssetsContractCase: AssetsContractCase = {
  name: 'R2AssetsRepository (in-memory R2 stub)',
  makeRepo: () => {
    const bucket = new InMemoryR2AssetsBucket();
    return new R2AssetsRepository({
      bucket: bucket as unknown as R2Bucket,
      dangerouslyAllowAllFiles: true,
    } as never);
  },
  /**
   * R2's `delete` is idempotent — it succeeds whether or not the key existed —
   * so this impl can't distinguish removed-vs-skipped from R2 alone.
   */
  skip: ['deleteAssetsTracksSkipped'],
};

assetsContractRegistry.push(r2AssetsContractCase);
