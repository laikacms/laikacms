import * as Result from 'effect/Result';

import type { LaikaResult } from 'laikacms/core';
import {
  EntryAlreadyExistsError,
  InternalError,
  NotFoundError,
  ServiceUnavailableError,
} from 'laikacms/core';

// ---------------------------------------------------------------------------
// Structural MongoDB interface
// ---------------------------------------------------------------------------
//
// The package avoids depending on the `mongodb` driver directly — three
// reasons:
//
//   1. `mongodb` is a heavy native-binary dependency that doesn't ship in
//      edge runtimes (Workers, Edge Functions, browsers).
//   2. Users may already have a configured `MongoClient` and don't want a
//      second copy.
//   3. The Atlas Data API and similar HTTP wrappers can implement the same
//      surface without pulling in the official driver.
//
// We declare only the methods the repository actually calls. Both the
// official driver's `Collection<T>` *and* a thin `fetch`-based shim satisfy
// the shape — that's structural typing earning its keep.

/** Any value usable in a Mongo filter for our limited query set. */
export type FilterValue =
  | string
  | number
  | boolean
  | { $eq?: unknown; $in?: unknown[]; $ne?: unknown };

export type Filter = Record<string, FilterValue | Record<string, unknown>>;

/** Subset of an aggregation pipeline stage relevant here. */
export type PipelineStage =
  | { $match: Filter }
  | { $sort: Record<string, 1 | -1> }
  | { $project: Record<string, 0 | 1> }
  | { $limit: number }
  | { $skip: number };

export interface InsertOneResult { insertedId?: unknown; acknowledged?: boolean }
export interface UpdateResult {
  matchedCount: number;
  modifiedCount: number;
  upsertedCount?: number;
  upsertedId?: unknown;
}
export interface DeleteResult { deletedCount: number }
export interface BulkWriteResult {
  insertedCount?: number;
  matchedCount?: number;
  modifiedCount?: number;
  deletedCount?: number;
  upsertedCount?: number;
}

/** Cursor-like — both the driver and our mock yield this. */
export interface MongoCursor<T> {
  toArray(): Promise<T[]>;
}

/**
 * Minimal structural Collection interface. Subset of the official
 * `mongodb` driver's `Collection<T>` shape; designed to be satisfiable
 * by a hand-rolled mock or an HTTP-API wrapper.
 */
export interface MongoCollectionLike<T extends { _id?: unknown }> {
  findOne(filter: Filter): Promise<T | null>;
  insertOne(doc: T): Promise<InsertOneResult>;
  replaceOne(filter: Filter, doc: T, options?: { upsert?: boolean }): Promise<UpdateResult>;
  deleteMany(filter: Filter): Promise<DeleteResult>;
  countDocuments(filter: Filter): Promise<number>;
  aggregate(pipeline: PipelineStage[]): MongoCursor<T>;
}

// ---------------------------------------------------------------------------
// Storage document shape
// ---------------------------------------------------------------------------

/** One row in the Mongo collection backing a Laika storage repo. */
export interface StorageDoc {
  _id: string;
  type: 'file' | 'folder';
  parent: string;
  name: string;
  extension?: string;
  content?: string;
  createdAt?: string;
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Error normalisation
// ---------------------------------------------------------------------------

/**
 * Recognise the canonical "duplicate key" error from the MongoDB driver.
 * Different driver versions report it differently; we check both fields
 * and the message text.
 */
const isDuplicateKeyError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: number; codeName?: string; name?: string; message?: string };
  if (e.code === 11000 || e.codeName === 'DuplicateKey') return true;
  if (typeof e.message === 'string' && /duplicate key|E11000/i.test(e.message)) return true;
  return false;
};

const mapError = (err: unknown, context: string): NotFoundError | EntryAlreadyExistsError | ServiceUnavailableError | InternalError => {
  if (isDuplicateKeyError(err)) {
    return new EntryAlreadyExistsError(`MongoDB duplicate key for ${context}`, { cause: err });
  }
  if (typeof err === 'object' && err !== null) {
    const e = err as { name?: string; code?: number; message?: string };
    if (e.name === 'MongoNetworkError' || e.name === 'MongoServerSelectionError') {
      return new ServiceUnavailableError(`MongoDB unreachable for ${context}`, { cause: err });
    }
  }
  return new InternalError(`MongoDB operation failed for ${context}`, { cause: err });
};

// ---------------------------------------------------------------------------
// Data source
// ---------------------------------------------------------------------------

export interface MongoDataSourceOptions {
  readonly collection: MongoCollectionLike<StorageDoc>;
}

/**
 * Talks to a single MongoDB collection storing Laika's flat document model.
 *
 * Five methods carry the work:
 *
 *  - `findFileDoc(parent, name)` — single `findOne` on `(type, parent, name)`.
 *  - `findById(id)` — direct primary-key lookup.
 *  - `insertOne(doc)` — create-only; surfaces 11000 as `EntryAlreadyExistsError`.
 *  - `upsert(doc)` — `replaceOne` with `{upsert: true}`.
 *  - `aggregateChildren(parent)` — **aggregation pipeline** for listings;
 *    `[{$match: {parent}}, {$sort: {name: 1}}, {$project: {content: 0}}]`.
 *    The repository never materialises the content field for list views.
 *  - `deleteByIds(ids)` — single `deleteMany({_id: {$in: ids}})` for atomic
 *    multi-key removal.
 */
export class MongoDataSource {
  private readonly collection: MongoCollectionLike<StorageDoc>;

  constructor(options: MongoDataSourceOptions) {
    this.collection = options.collection;
  }

  async findFileDoc(parent: string, name: string): Promise<LaikaResult<StorageDoc | null>> {
    try {
      const doc = await this.collection.findOne({ type: 'file', parent, name });
      return Result.succeed(doc);
    } catch (err) {
      return Result.fail(mapError(err, `findFileDoc(${parent}/${name})`));
    }
  }

  async findById(id: string): Promise<LaikaResult<StorageDoc | null>> {
    try {
      const doc = await this.collection.findOne({ _id: id });
      return Result.succeed(doc);
    } catch (err) {
      return Result.fail(mapError(err, `findById(${id})`));
    }
  }

  /** Insert-only — fails on duplicate key. */
  async insertOne(doc: StorageDoc): Promise<LaikaResult<void>> {
    try {
      await this.collection.insertOne(doc);
      return Result.succeed(undefined);
    } catch (err) {
      return Result.fail(mapError(err, doc._id));
    }
  }

  /** Upsert by `_id`. */
  async upsert(doc: StorageDoc): Promise<LaikaResult<void>> {
    try {
      await this.collection.replaceOne({ _id: doc._id }, doc, { upsert: true });
      return Result.succeed(undefined);
    } catch (err) {
      return Result.fail(mapError(err, doc._id));
    }
  }

  /**
   * List children of `parent` via an aggregation pipeline. Excludes the
   * `content` field — listings should not pull every document body over
   * the wire.
   */
  async aggregateChildren(parent: string): Promise<LaikaResult<StorageDoc[]>> {
    try {
      const docs = await this.collection
        .aggregate([
          { $match: { parent } },
          { $sort: { name: 1 } },
          { $project: { content: 0 } },
        ])
        .toArray();
      return Result.succeed(docs);
    } catch (err) {
      return Result.fail(mapError(err, `aggregateChildren(${parent})`));
    }
  }

  /** Any descendant under `parent` exists? */
  async hasDescendants(parent: string): Promise<LaikaResult<boolean>> {
    try {
      const count = await this.collection.countDocuments({ parent });
      return Result.succeed(count > 0);
    } catch (err) {
      return Result.fail(mapError(err, `hasDescendants(${parent})`));
    }
  }

  /**
   * Delete a set of docs by `_id` in **one** round-trip via
   * `deleteMany({_id: {$in: [...]}})`. Returns the count actually deleted.
   */
  async deleteByIds(ids: string[]): Promise<LaikaResult<number>> {
    if (ids.length === 0) return Result.succeed(0);
    try {
      const result = await this.collection.deleteMany({ _id: { $in: ids } });
      return Result.succeed(result.deletedCount);
    } catch (err) {
      return Result.fail(mapError(err, `deleteByIds(${ids.length})`));
    }
  }
}
