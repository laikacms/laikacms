import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DdbStorageRepository } from './ddb-storage-repository.js';
import { ddbContractCase } from './testing/index.js';

runStorageRepositoryContract(ddbContractCase);

// ---------------------------------------------------------------------------
// Wire the official aws-sdk-client-mock to an in-memory Map<pk, Map<sk, row>>
// so the repository can be exercised end-to-end against realistic DynamoDB
// semantics: Get returns `Item` or nothing, Query pages results, etc.
// ---------------------------------------------------------------------------

const TABLE = 'storage-table';
const PK = 'PK';
const SK = 'SK';

const setupMock = () => {
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

  return { ddbMock, store };
};

let ctx: ReturnType<typeof setupMock>;

beforeEach(() => {
  ctx = setupMock();
});
afterEach(() => {
  ctx.ddbMock.restore();
  ctx.store.clear();
});

const makeRepo = (partitionPrefix = 'STORAGE#') =>
  new DdbStorageRepository({
    docClient: DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' })),
    tableName: TABLE,
    partitionPrefix,
    serializerRegistry: {
      md: {
        format: { mediaType: 'text/markdown' } as never,
        serializeDocumentFileContents: async content => String((content as { body?: string }).body ?? ''),
        deserializeDocumentFileContents: async raw => ({ body: raw }),
      },
    },
    defaultFileExtension: 'md',
  });

const seedFile = (parent: string, name: string, content = '', extension = 'md'): void => {
  const pk = `STORAGE#${parent}`;
  if (!ctx.store.has(pk)) ctx.store.set(pk, new Map());
  ctx.store.get(pk)!.set(name, {
    PK: pk,
    SK: name,
    Type: 'file',
    Content: content,
    Extension: extension,
    CreatedAt: new Date('2026-05-01').toISOString(),
    UpdatedAt: new Date('2026-05-01').toISOString(),
    ETag: `etag-seed-${parent}-${name}`,
  });
};

const seedFolder = (parent: string, name: string): void => {
  const pk = `STORAGE#${parent}`;
  if (!ctx.store.has(pk)) ctx.store.set(pk, new Map());
  ctx.store.get(pk)!.set(name, {
    PK: pk,
    SK: name,
    Type: 'folder',
    CreatedAt: new Date('2026-05-01').toISOString(),
    UpdatedAt: new Date('2026-05-01').toISOString(),
    ETag: `etag-seed-folder-${parent}-${name}`,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DdbStorageRepository listing', () => {
  it('sorts numeric filenames naturally and strips extensions', async () => {
    seedFolder('', 'root-marker'); // satisfy folderExists for root
    seedFile('', '1.md');
    seedFile('', '2.md');
    seedFile('', '10.md');
    seedFile('', '11.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );

    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10', '11', 'root-marker']);
  });

  it('classifies files as object-summary and folders as folder-summary', async () => {
    seedFolder('', 'notes');
    seedFile('notes', 'a.md');
    seedFile('', 'top.md');

    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    const byKey = Object.fromEntries(collected.data.map(s => [s.key, s.type] as const));
    expect(byKey).toEqual({ notes: 'folder-summary', top: 'object-summary' });
  });

  it('reports a missing folder as a recoverable NotFoundError, not a fatal failure', async () => {
    const collected = await LaikaStream.runPromiseCollect(
      makeRepo().listAtomSummaries('does/not/exist', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data).toEqual([]);
    expect(collected.recoverableErrors).toHaveLength(1);
    expect(collected.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });
});

describe('DdbStorageRepository CRUD round-trip', () => {
  it('creates, reads, updates and deletes an object', async () => {
    const repo = makeRepo();

    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('hello');
    expect(created.content).toEqual({ body: 'hi' });
    expect(created.metadata?.extension).toBe('md');
    expect(created.metadata?.revisionId).toBeTruthy();
    expect(ctx.store.get('STORAGE#')?.get('hello.md')).toBeTruthy();

    const updated = await LaikaTask.runPromise(
      repo.updateObject({ key: 'hello', content: { body: 'updated' } }),
    );
    expect(updated.content).toEqual({ body: 'updated' });
    expect(updated.metadata?.revisionId).not.toBe(created.metadata?.revisionId);

    const removed = await LaikaStream.runPromiseCollect(repo.removeAtoms(['hello']));
    expect(removed.data).toEqual(['hello']);
    expect(removed.done).toEqual({ removed: 1, skipped: 0 });
    expect(ctx.store.get('STORAGE#')?.get('hello.md')).toBeUndefined();
  });

  it('createObject auto-creates ancestor folder markers for deep keys', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c', content: { body: 'deep' } }),
    );
    expect(ctx.store.get('STORAGE#')?.get('a')?.Type).toBe('folder');
    expect(ctx.store.get('STORAGE#a')?.get('b')?.Type).toBe('folder');
    expect(ctx.store.get('STORAGE#a/b')?.get('c.md')?.Type).toBe('file');
  });

  it('rejects a second createObject for the same key', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'hello', content: { body: 'one' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'hello', content: { body: 'two' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('createFolder writes a folder marker that subsequent listings expose', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    expect(ctx.store.get('STORAGE#')?.get('notes')?.Type).toBe('folder');

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: { offset: 0, limit: 100 } }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['notes']);
    expect(collected.data[0].type).toBe('folder-summary');
  });

  it('refuses to delete a non-empty folder (recoverable warning, not fatal)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes' }));
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'x' } }),
    );

    const attempt = await LaikaStream.runPromiseCollect(repo.removeAtoms(['notes']));
    expect(attempt.data).toEqual([]);
    expect(attempt.done.skipped).toBe(1);
    expect(attempt.recoverableErrors).toHaveLength(1);
    expect(ctx.store.get('STORAGE#')?.get('notes')).toBeTruthy();
  });
});

describe('DdbStorageRepository multi-tenant', () => {
  it('honours partitionPrefix — tenants never see each other', async () => {
    const tenantA = makeRepo('TENANT_A#');
    const tenantB = makeRepo('TENANT_B#');

    await LaikaTask.runPromise(
      tenantA.createObject({ type: 'object', key: 'shared', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      tenantB.createObject({ type: 'object', key: 'shared', content: { body: 'b' } }),
    );

    const a = await LaikaTask.runPromise(tenantA.getObject('shared'));
    const b = await LaikaTask.runPromise(tenantB.getObject('shared'));
    expect(a.content).toEqual({ body: 'a' });
    expect(b.content).toEqual({ body: 'b' });
    expect(ctx.store.has('TENANT_A#')).toBe(true);
    expect(ctx.store.has('TENANT_B#')).toBe(true);
  });
});
