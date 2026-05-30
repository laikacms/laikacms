import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import type { StorageContractCase } from 'laikacms/storage/testing';

import { DdbStorageRepository } from '../ddb-storage-repository.js';

const TABLE = 'storage-table';
const PK = 'PK';
const SK = 'SK';

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
});

export const ddbContractCase: StorageContractCase = {
  name: 'DdbStorageRepository',
  makeRepo() {
    const store = new Map<string, Map<string, Record<string, unknown>>>();
    const ddbMock = mockClient(DynamoDBDocumentClient);

    ddbMock.on(GetCommand).callsFake(input => {
      const partition = store.get(input.Key[PK] as string);
      const item = partition?.get(input.Key[SK] as string);
      return item ? { Item: { ...item } } : {};
    });

    ddbMock.on(PutCommand).callsFake(input => {
      const pk = input.Item[PK] as string;
      const sk = input.Item[SK] as string;
      if (input.ConditionExpression === 'attribute_not_exists(#sk)') {
        const existing = store.get(pk)?.get(sk);
        if (existing) {
          const err = new Error('The conditional request failed');
          (err as { name: string }).name = 'ConditionalCheckFailedException';
          throw err;
        }
      }
      if (!store.has(pk)) store.set(pk, new Map());
      store.get(pk)!.set(sk, { ...input.Item });
      return {};
    });

    ddbMock.on(QueryCommand).callsFake(input => {
      const pk = input.ExpressionAttributeValues?.[':pk'] as string;
      const prefix = input.ExpressionAttributeValues?.[':prefix'] as string | undefined;
      const partition = store.get(pk);
      if (!partition) return { Items: [] };
      const rows = [...partition.entries()]
        .filter(([sk]) => (prefix === undefined ? true : sk.startsWith(prefix)))
        .map(([, row]) => ({ ...row }));
      return { Items: rows };
    });

    ddbMock.on(DeleteCommand).callsFake(input => {
      const pk = input.Key[PK] as string;
      const sk = input.Key[SK] as string;
      store.get(pk)?.delete(sk);
      if (store.get(pk)?.size === 0) store.delete(pk);
      return {};
    });

    return new DdbStorageRepository({
      docClient: DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })),
      tableName: TABLE,
      partitionPrefix: 'STORAGE#',
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
