import type { StorageContractCase } from 'laikacms/storage/testing';

import type { BlobEntry, BlobOps, BlobProperties } from '../blob-datasource.js';
import { AzureBlobStorageRepository } from '../blob-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory BlobOps mock — satisfies the BlobOps interface directly so
// no Azure SDK is involved. State is isolated per makeRepo() call.
// ---------------------------------------------------------------------------

const createMockBlobOps = (): BlobOps => {
  // Map from blob name → { content, contentType, etag, lastModified }
  const blobs = new Map<string, { content: string, contentType: string, etag: string, lastModified: Date }>();
  let etagCounter = 0;
  const newEtag = (): string => `"${(++etagCounter).toString(36)}"`;

  return {
    async exists(name: string): Promise<boolean> {
      return blobs.has(name);
    },

    async getProperties(name: string): Promise<BlobProperties | null> {
      const blob = blobs.get(name);
      if (!blob) return null;
      return {
        contentLength: new TextEncoder().encode(blob.content).byteLength,
        lastModified: blob.lastModified,
        etag: blob.etag,
        contentType: blob.contentType,
      };
    },

    async download(name: string): Promise<string> {
      const blob = blobs.get(name);
      if (!blob) throw Object.assign(new Error(`BlobNotFound: ${name}`), { code: 'BlobNotFound', statusCode: 404 });
      return blob.content;
    },

    async upload(name: string, content: string, contentType: string): Promise<BlobProperties> {
      const etag = newEtag();
      const lastModified = new Date();
      blobs.set(name, { content, contentType, etag, lastModified });
      return {
        contentLength: new TextEncoder().encode(content).byteLength,
        lastModified,
        etag,
        contentType,
      };
    },

    async delete(name: string): Promise<void> {
      blobs.delete(name);
    },

    async *listByHierarchy(prefix: string, delimiter: string): AsyncIterable<BlobEntry> {
      // Collect names with this prefix.
      const seen = new Set<string>();
      for (const name of blobs.keys()) {
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        const idx = rest.indexOf(delimiter);
        if (idx === -1) {
          // It's a direct blob under this prefix.
          yield { kind: 'blob', name };
        } else {
          // It's under a "subfolder" — emit the common prefix once.
          const dirPrefix = prefix + rest.slice(0, idx + 1);
          if (!seen.has(dirPrefix)) {
            seen.add(dirPrefix);
            yield { kind: 'prefix', name: dirPrefix };
          }
        }
      }
    },
  };
};

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const azureContractCase: StorageContractCase = {
  name: 'AzureBlobStorageRepository',
  async makeRepo() {
    const ops = createMockBlobOps();
    return new AzureBlobStorageRepository({
      ops,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
