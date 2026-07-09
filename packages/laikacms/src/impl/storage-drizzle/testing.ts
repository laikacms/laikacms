import type { StorageContractCase } from '../../domain/storage/testing/index.js';

import {
  type DrizzleStorageCallbacks,
  type DrizzleStorageQueryBuilders,
  DrizzleStorageRepository,
  type StorageModel,
} from './storage-repository.js';

type Cond =
  | { kind: 'eq', key: string }
  | { kind: 'startsWith', prefix: string }
  | { kind: 'depthLte', depth: number }
  | { kind: 'and', children: Cond[] };

const matches = (row: StorageModel, cond: Cond): boolean => {
  if (cond.kind === 'eq') return row.key === cond.key;
  if (cond.kind === 'startsWith') return row.key.startsWith(cond.prefix);
  if (cond.kind === 'depthLte') return row.depth <= cond.depth;
  return cond.children.every(c => matches(row, c));
};

/**
 * In-memory backing store driving the Drizzle abstractions. The repository
 * never sees a real database; it only knows about the callbacks/builders it
 * was given. This exercises every code path that depends on those callbacks
 * being honoured.
 */
const makeInMemoryStore = () => {
  const rows: StorageModel[] = [];

  const queryBuilders: DrizzleStorageQueryBuilders = {
    keyEquals: value => ({ kind: 'eq', key: value }) as Cond,
    keyStartsWith: prefix => ({ kind: 'startsWith', prefix }) as Cond,
    depthLte: value => ({ kind: 'depthLte', depth: value }) as Cond,
    and: (...children) => ({ kind: 'and', children: children as Cond[] }) as Cond,
  };

  const callbacks: DrizzleStorageCallbacks = {
    async insert({ values }) {
      const existingIndex = rows.findIndex(r => r.key === values.key);
      if (existingIndex !== -1) rows.splice(existingIndex, 1);
      rows.push({ ...values });
      return [{ ...values }];
    },
    async update({ where, values }) {
      const cond = where as Cond;
      const updated: StorageModel[] = [];
      for (let i = 0; i < rows.length; i += 1) {
        if (matches(rows[i]!, cond)) {
          rows[i] = { ...rows[i]!, ...values };
          updated.push({ ...rows[i]! });
        }
      }
      return updated;
    },
    async delete({ where }) {
      const cond = where as Cond;
      const removed: StorageModel[] = [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i]!, cond)) {
          removed.push(rows[i]!);
          rows.splice(i, 1);
        }
      }
      return removed;
    },
    async select({ where, limit, offset }) {
      const cond = where as Cond;
      const out = rows.filter(r => matches(r, cond));
      out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      const sliced = offset ? out.slice(offset) : out;
      return limit ? sliced.slice(0, limit) : sliced;
    },
    async count({ where }) {
      const cond = where as Cond;
      return rows.filter(r => matches(r, cond)).length;
    },
  };

  return { queryBuilders, callbacks, rows };
};

export const drizzleStorageContractCase: StorageContractCase = {
  name: 'DrizzleStorageRepository (in-memory builders)',
  makeRepo: async () => {
    const { queryBuilders, callbacks } = makeInMemoryStore();
    return new DrizzleStorageRepository({ queryBuilders, callbacks });
  },
};
