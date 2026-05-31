import type { StorageContractCase } from 'laikacms/storage/testing';

import {
  type Filter,
  type MongoCollectionLike,
  MongoDataSource,
  type PipelineStage,
  type StorageDoc,
} from '../mongodb-datasource.js';
import { MongoStorageRepository } from '../mongodb-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory MongoDB mock — all state is local to each MockCollection instance
// so every makeRepo() call gets a fully isolated store.
// ---------------------------------------------------------------------------

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

const evaluatePipeline = (docs: StorageDoc[], pipeline: PipelineStage[]): StorageDoc[] => {
  let working = [...docs];
  for (const stage of pipeline) {
    if ('$match' in stage) {
      const pred = makeFilterPredicate(stage.$match);
      working = working.filter(pred);
    } else if ('$sort' in stage) {
      const [field, dir] = Object.entries(stage.$sort)[0]!;
      working.sort((a, b) => {
        const va = String((a as unknown as Record<string, unknown>)[field!] ?? '');
        const vb = String((b as unknown as Record<string, unknown>)[field!] ?? '');
        return dir === 1 ? va.localeCompare(vb) : vb.localeCompare(va);
      });
    } else if ('$project' in stage) {
      working = working.map(doc => {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(doc)) {
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

class MockCollection implements MongoCollectionLike<StorageDoc> {
  private readonly store = new Map<string, StorageDoc>();

  async findOne(filter: Filter): Promise<StorageDoc | null> {
    const pred = makeFilterPredicate(filter);
    for (const doc of this.store.values()) if (pred(doc)) return { ...doc };
    return null;
  }

  async insertOne(doc: StorageDoc) {
    if (this.store.has(doc._id)) {
      const err = Object.assign(new Error(`E11000 duplicate key error: ${doc._id}`), { code: 11000 });
      throw err;
    }
    this.store.set(doc._id, { ...doc });
    return { insertedId: doc._id, acknowledged: true };
  }

  async replaceOne(filter: Filter, doc: StorageDoc, options?: { upsert?: boolean }) {
    const pred = makeFilterPredicate(filter);
    let matched = 0;
    for (const [id, d] of this.store) {
      if (pred(d)) {
        this.store.set(id, { ...doc, _id: id });
        matched = 1;
        break;
      }
    }
    if (matched === 0 && options?.upsert) {
      this.store.set(doc._id, { ...doc });
      return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: doc._id };
    }
    return { matchedCount: matched, modifiedCount: matched };
  }

  async deleteMany(filter: Filter) {
    const pred = makeFilterPredicate(filter);
    let deletedCount = 0;
    for (const [id, doc] of [...this.store]) {
      if (pred(doc)) {
        this.store.delete(id);
        deletedCount += 1;
      }
    }
    return { deletedCount };
  }

  async countDocuments(filter: Filter): Promise<number> {
    const pred = makeFilterPredicate(filter);
    let n = 0;
    for (const doc of this.store.values()) if (pred(doc)) n += 1;
    return n;
  }

  aggregate(pipeline: PipelineStage[]) {
    const snapshot = [...this.store.values()];
    return {
      async toArray() {
        return evaluatePipeline(snapshot, pipeline);
      },
    };
  }
}

const serializerRegistry = {
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as unknown,
  },
};

export const mongodbContractCase: StorageContractCase = {
  name: 'MongoStorageRepository',
  async makeRepo(): Promise<MongoStorageRepository> {
    const collection = new MockCollection();
    const dataSource = new MongoDataSource({ collection });
    return new MongoStorageRepository({
      dataSource,
      serializerRegistry: serializerRegistry as never,
      defaultFileExtension: 'json',
    });
  },
};
