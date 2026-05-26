import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  type Filter,
  type MongoCollectionLike,
  MongoDataSource,
  type PipelineStage,
  type StorageDoc,
} from './mongodb-datasource.js';
import { MongoStorageRepository } from './mongodb-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory MongoDB mock. Implements `MongoCollectionLike` over a plain Map.
//
// The filter evaluator handles exactly the operator subset the repository
// emits:
//   - plain equality:                   {field: value}
//   - $in:                               {field: {$in: [...]}}
//   - implicit $and (multiple fields):  {f1: v1, f2: v2}
//
// The aggregation pipeline evaluator handles:
//   - $match  (reuses the filter evaluator)
//   - $sort
//   - $project (exclusion only — {field: 0})
//   - $limit / $skip
// ---------------------------------------------------------------------------

let store: Map<string, StorageDoc>;
let aggregateCount = 0;
let deleteManyCount = 0;
let findOneCount = 0;

// ---- Filter evaluator ----------------------------------------------------

type Predicate = (doc: StorageDoc) => boolean;

const valueMatches = (docVal: unknown, expected: unknown): boolean => {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    const ops = expected as Record<string, unknown>;
    for (const [op, opVal] of Object.entries(ops)) {
      if (op === '$in' && Array.isArray(opVal)) {
        if (!opVal.includes(docVal)) return false;
      } else if (op === '$eq') {
        if (docVal !== opVal) return false;
      } else if (op === '$ne') {
        if (docVal === opVal) return false;
      } else {
        throw new Error(`unsupported filter op: ${op}`);
      }
    }
    return true;
  }
  return docVal === expected;
};

const makeFilterPredicate = (filter: Filter): Predicate => {
  const subs: Predicate[] = [];
  for (const [k, v] of Object.entries(filter)) {
    subs.push(doc => valueMatches((doc as unknown as Record<string, unknown>)[k], v));
  }
  return doc => subs.every(p => p(doc));
};

// ---- Pipeline evaluator --------------------------------------------------

const evaluatePipeline = (
  docs: StorageDoc[],
  pipeline: PipelineStage[],
): StorageDoc[] => {
  let working = [...docs];
  for (const stage of pipeline) {
    if ('$match' in stage) {
      const pred = makeFilterPredicate(stage.$match);
      working = working.filter(pred);
    } else if ('$sort' in stage) {
      const [field, dir] = Object.entries(stage.$sort)[0]!;
      working.sort((a, b) => {
        const va = String((a as unknown as Record<string, unknown>)[field] ?? '');
        const vb = String((b as unknown as Record<string, unknown>)[field] ?? '');
        return dir === 1 ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    } else if ('$project' in stage) {
      working = working.map(doc => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(doc)) {
          // Only exclusion ({field: 0}) is supported here — matches the
          // repository's actual usage.
          if (stage.$project[k] === 0) continue;
          out[k] = v;
        }
        return out as StorageDoc;
      });
    } else if ('$limit' in stage) {
      working = working.slice(0, stage.$limit);
    } else if ('$skip' in stage) {
      working = working.slice(stage.$skip);
    }
  }
  return working;
};

// ---- Collection implementation -------------------------------------------

class MockCollection implements MongoCollectionLike<StorageDoc> {
  async findOne(filter: Filter): Promise<StorageDoc | null> {
    findOneCount += 1;
    const pred = makeFilterPredicate(filter);
    for (const doc of store.values()) if (pred(doc)) return { ...doc };
    return null;
  }

  async insertOne(doc: StorageDoc) {
    if (store.has(doc._id)) {
      // Mongo signals duplicate key with code 11000.
      const err = Object.assign(new Error(`E11000 duplicate key error: ${doc._id}`), { code: 11000 });
      throw err;
    }
    store.set(doc._id, { ...doc });
    return { insertedId: doc._id, acknowledged: true };
  }

  async replaceOne(filter: Filter, doc: StorageDoc, options?: { upsert?: boolean }) {
    const pred = makeFilterPredicate(filter);
    let matched = 0;
    for (const [id, d] of store) {
      if (pred(d)) {
        store.set(id, { ...doc, _id: id });
        matched = 1;
        break;
      }
    }
    if (matched === 0 && options?.upsert) {
      store.set(doc._id, { ...doc });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
    }
    return { matchedCount: matched, modifiedCount: matched };
  }

  async deleteMany(filter: Filter) {
    deleteManyCount += 1;
    const pred = makeFilterPredicate(filter);
    let deletedCount = 0;
    for (const [id, doc] of [...store]) {
      if (pred(doc)) {
        store.delete(id);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }

  async countDocuments(filter: Filter): Promise<number> {
    const pred = makeFilterPredicate(filter);
    let n = 0;
    for (const doc of store.values()) if (pred(doc)) n += 1;
    return n;
  }

  aggregate(pipeline: PipelineStage[]) {
    aggregateCount += 1;
    const snapshot = [...store.values()];
    return {
      async toArray() {
        return evaluatePipeline(snapshot, pipeline);
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Minimal test serializer registry.
// ---------------------------------------------------------------------------

const serializerRegistry = {
  md: {
    format: { mediaType: 'text/markdown' } as never,
    serializeDocumentFileContents: async (content: unknown) => String((content as { body?: string }).body ?? ''),
    deserializeDocumentFileContents: async (raw: string) => ({ body: raw }),
  },
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw),
  },
};

const PAGE = { offset: 0, limit: 100 };

const makeRepo = (): MongoStorageRepository => {
  const collection = new MockCollection();
  const dataSource = new MongoDataSource({ collection });
  return new MongoStorageRepository({
    dataSource,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  store = new Map();
  aggregateCount = 0;
  deleteManyCount = 0;
  findOneCount = 0;
});

afterEach(() => {
  store.clear();
});

describe('MongoStorageRepository', () => {
  it('createObject + getObject round-trip stores doc with type/parent/name/extension', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');

    const stored = store.get('notes/hello.md');
    expect(stored).toMatchObject({
      type: 'file',
      parent: 'notes',
      name: 'hello',
      extension: 'md',
      content: 'hi',
    });

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('createObject rejects duplicates via 11000 → EntryAlreadyExistsError', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await expect(
      LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'b' } }),
      ),
    ).rejects.toThrow(/already exists/i);
  });

  it('updateObject overwrites in place; getObject reads back', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    expect(store.get('notes/x.md')?.content).toBe('b');
    const fetched = await LaikaTask.runPromise(repo.getObject('notes/x'));
    expect(fetched.content).toEqual({ body: 'b' });
  });

  it('removeAtoms packs into a single deleteMany({_id: {$in: ...}}) call', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    deleteManyCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // The distinctive single-roundtrip property — irrespective of N.
    expect(deleteManyCount).toBe(1);
    expect(store.size).toBe(0);
  });

  it('removeAtoms reports missing keys as skipped', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors.length).toBe(1);
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries dispatches an aggregation pipeline; suppresses content', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'notes/sub' }));

    // Sniff the pipeline used.
    aggregateCount = 0;
    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    expect(aggregateCount).toBe(1);
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
  });

  it('aggregation pipeline includes the $project: {content: 0} stage', async () => {
    // Intercept the pipeline stages handed to the collection.
    const captured: PipelineStage[][] = [];
    class SnoopCollection extends MockCollection {
      override aggregate(pipeline: PipelineStage[]) {
        captured.push(pipeline);
        return super.aggregate(pipeline);
      }
    }
    const ds = new MongoDataSource({ collection: new SnoopCollection() });
    const repo = new MongoStorageRepository({
      dataSource: ds,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'md',
    });
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'x', content: { body: 'x' } }),
    );
    await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: PAGE }),
    );
    expect(captured.length).toBeGreaterThan(0);
    const pipeline = captured.at(-1)!;
    expect(pipeline.some(s => '$match' in s)).toBe(true);
    expect(pipeline.some(s => '$sort' in s)).toBe(true);
    // *The* load-bearing stage — without it, listing pulls every body.
    expect(pipeline.some(s => '$project' in s && (s as { $project: Record<string, 0 | 1> }).$project.content === 0))
      .toBe(true);
  });

  it('listAtomSummaries orders results naturally', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '10', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '2', content: { body: 'b' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: '1', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('', { pagination: PAGE }),
    );
    expect(collected.data.map(s => s.key)).toEqual(['1', '2', '10']);
  });

  it('createFolder creates an explicit folder document', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    expect(store.get('empty')).toMatchObject({ type: 'folder', parent: '', name: 'empty' });

    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder also recognises a folder via descendants (implicit)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'x' } }),
    );
    const folder = await LaikaTask.runPromise(repo.getFolder('notes'));
    expect(folder.type).toBe('folder');
  });

  it('getFolder fails for a missing path', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });
});
