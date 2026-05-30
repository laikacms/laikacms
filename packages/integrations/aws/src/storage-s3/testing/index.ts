import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { S3StorageRepository } from '../s3-storage-repository.js';

const BUCKET = 'test-bucket';

interface StoredObject {
  body: string;
  contentType?: string;
  lastModified: Date;
  etag: string;
}

const stringBody = (body: string) => ({
  transformToString: async () => body,
});

const notFoundError = () => {
  const err = new Error('NoSuchKey');
  (err as { name: string }).name = 'NoSuchKey';
  (err as { $metadata: unknown }).$metadata = { httpStatusCode: 404 };
  return err;
};

// Use 'md' as default extension so the contract-test keys (ending in .json)
// are not stripped when returned — the S3 repo strips registered extensions
// from returned keys, so if we registered 'json' the contract key
// 'contract-test/foo.json' would come back as 'contract-test/foo'.
const makeSerializerRegistry = () => ({
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
});

export const s3ContractCase: StorageContractCase = {
  name: 'S3StorageRepository',
  makeRepo() {
    const store = new Map<string, StoredObject>();
    let etagCounter = 0;
    const s3 = mockClient(S3Client);

    s3.on(HeadObjectCommand).callsFake(input => {
      const obj = store.get(input.Key);
      if (!obj) throw notFoundError();
      return {
        ContentLength: obj.body.length,
        LastModified: obj.lastModified,
        ETag: obj.etag,
        ContentType: obj.contentType,
      };
    });

    s3.on(GetObjectCommand).callsFake(input => {
      const obj = store.get(input.Key);
      if (!obj) throw notFoundError();
      return {
        Body: stringBody(obj.body),
        LastModified: obj.lastModified,
        ETag: obj.etag,
        ContentLength: obj.body.length,
      };
    });

    s3.on(PutObjectCommand).callsFake(input => {
      etagCounter += 1;
      store.set(input.Key, {
        body: typeof input.Body === 'string' ? input.Body : '',
        contentType: input.ContentType,
        lastModified: new Date(),
        etag: `etag-${etagCounter}`,
      });
      return { ETag: `etag-${etagCounter}` };
    });

    s3.on(DeleteObjectCommand).callsFake(input => {
      store.delete(input.Key);
      return {};
    });

    s3.on(ListObjectsV2Command).callsFake(input => {
      const prefix = input.Prefix ?? '';
      const delimiter = input.Delimiter;
      const maxKeys = input.MaxKeys ?? 1000;

      const contents: Array<{ Key: string, LastModified: Date, Size: number, ETag: string }> = [];
      const commonPrefixSet = new Set<string>();

      for (const [key, obj] of store) {
        if (!key.startsWith(prefix)) continue;
        const remainder = key.slice(prefix.length);
        if (delimiter && remainder.includes(delimiter)) {
          const idx = remainder.indexOf(delimiter);
          commonPrefixSet.add(prefix + remainder.slice(0, idx + delimiter.length));
          continue;
        }
        contents.push({ Key: key, LastModified: obj.lastModified, Size: obj.body.length, ETag: obj.etag });
      }

      return {
        Contents: contents.slice(0, maxKeys),
        CommonPrefixes: [...commonPrefixSet].map(p => ({ Prefix: p })),
        IsTruncated: false,
        KeyCount: contents.length + commonPrefixSet.size,
      };
    });

    return new S3StorageRepository({
      client: new S3Client({ region: 'us-east-1' }),
      bucket: BUCKET,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'md',
    });
  },
};
