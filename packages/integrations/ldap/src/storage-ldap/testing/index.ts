import type { StorageObjectContent } from 'laikacms/storage';
import type { StorageContractCase } from 'laikacms/storage/testing';

import {
  type LdapBulkOp,
  type LdapBulkResult,
  LdapDataSource,
  type LdapEntry,
  type LdapModifyChange,
  type LdapOps,
  type LdapSearchOptions,
} from '../ldap-datasource.js';
import { LdapStorageRepository } from '../ldap-storage-repository.js';

const BASE_DN = 'ou=cms,dc=example,dc=com';

interface StoredEntry {
  dn: string;
  attributes: Record<string, string[]>;
}

const normaliseDn = (dn: string): string => dn.toLowerCase().replace(/\s*,\s*/g, ',').trim();

type Filter =
  | { kind: 'eq', attr: string, value: string, hasWildcard: boolean }
  | { kind: 'and', filters: Filter[] }
  | { kind: 'or', filters: Filter[] }
  | { kind: 'not', filter: Filter }
  | { kind: 'present', attr: string };

const parseFilter = (input: string): Filter => {
  let pos = 0;
  const skipWs = () => {
    while (pos < input.length && input[pos] === ' ') pos += 1;
  };
  const expectChar = (ch: string) => {
    if (input[pos] !== ch) throw new Error(`expected '${ch}' at ${pos} in ${input}`);
    pos += 1;
  };
  const parse = (): Filter => {
    skipWs();
    expectChar('(');
    skipWs();
    const ch = input[pos];
    if (ch === '&') {
      pos += 1;
      const fs: Filter[] = [];
      while (input[pos] !== ')') fs.push(parse());
      expectChar(')');
      return { kind: 'and', filters: fs };
    }
    if (ch === '|') {
      pos += 1;
      const fs: Filter[] = [];
      while (input[pos] !== ')') fs.push(parse());
      expectChar(')');
      return { kind: 'or', filters: fs };
    }
    if (ch === '!') {
      pos += 1;
      const inner = parse();
      expectChar(')');
      return { kind: 'not', filter: inner };
    }
    let attr = '';
    while (pos < input.length && input[pos] !== '=' && input[pos] !== ')') {
      attr += input[pos];
      pos += 1;
    }
    expectChar('=');
    let value = '';
    while (pos < input.length && input[pos] !== ')') {
      value += input[pos];
      pos += 1;
    }
    expectChar(')');
    if (value === '*') return { kind: 'present', attr };
    const decoded = value
      .replace(/\\28/g, '(').replace(/\\29/g, ')')
      .replace(/\\2a/g, '*').replace(/\\5c/g, '\\');
    return { kind: 'eq', attr, value: decoded, hasWildcard: decoded.includes('*') };
  };
  return parse();
};

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const evalFilter = (entry: StoredEntry, filter: Filter): boolean => {
  switch (filter.kind) {
    case 'and':
      return filter.filters.every(f => evalFilter(entry, f));
    case 'or':
      return filter.filters.some(f => evalFilter(entry, f));
    case 'not':
      return !evalFilter(entry, filter.filter);
    case 'present':
      if (filter.attr === 'objectClass') return entry.attributes['objectClass'] !== undefined;
      return entry.attributes[filter.attr] !== undefined;
    case 'eq': {
      const values = entry.attributes[filter.attr] ?? [];
      if (filter.hasWildcard) {
        const re = new RegExp('^' + filter.value.split('*').map(escapeRegex).join('.*') + '$');
        return values.some(v => re.test(v));
      }
      return values.includes(filter.value);
    }
  }
};

const parentDnOf = (dn: string): string => {
  const idx = dn.indexOf(',');
  return idx === -1 ? '' : dn.slice(idx + 1);
};

const createMockLdapOps = (): { ops: LdapOps, entries: Map<string, StoredEntry> } => {
  const entries = new Map<string, StoredEntry>();

  const ops: LdapOps = {
    async search(options: LdapSearchOptions): Promise<LdapEntry[]> {
      const filter = parseFilter(options.filter);
      const baseNormal = normaliseDn(options.base);
      const matches: StoredEntry[] = [];
      if (options.scope === 'base') {
        const entry = entries.get(baseNormal);
        if (entry && evalFilter(entry, filter)) matches.push(entry);
      } else if (options.scope === 'one') {
        for (const entry of entries.values()) {
          if (normaliseDn(parentDnOf(entry.dn)) === baseNormal && evalFilter(entry, filter)) {
            matches.push(entry);
          }
        }
      } else {
        for (const entry of entries.values()) {
          const en = normaliseDn(entry.dn);
          if ((en === baseNormal || en.endsWith(',' + baseNormal)) && evalFilter(entry, filter)) {
            matches.push(entry);
          }
        }
      }
      const limit = options.sizeLimit ?? Infinity;
      return matches.slice(0, limit).map(e => ({ dn: e.dn, attributes: { ...e.attributes } }));
    },

    async add(dn: string, attributes: Record<string, string | string[]>): Promise<void> {
      const norm = normaliseDn(dn);
      if (entries.has(norm)) {
        const err = new Error(`Entry already exists: ${dn}`);
        err.name = 'LdapEntryAlreadyExists';
        throw err;
      }
      const normalised: Record<string, string[]> = {};
      for (const [k, v] of Object.entries(attributes)) {
        normalised[k] = Array.isArray(v) ? [...v] : [v];
      }
      entries.set(norm, { dn, attributes: normalised });
    },

    async modify(dn: string, changes: ReadonlyArray<LdapModifyChange>): Promise<void> {
      const norm = normaliseDn(dn);
      const entry = entries.get(norm);
      if (!entry) {
        const err = new Error(`No such object: ${dn}`);
        err.name = 'LdapNoSuchObject';
        throw err;
      }
      for (const c of changes) {
        const { type, values } = c.modification;
        if (c.operation === 'replace') {
          entry.attributes[type] = [...values];
        } else if (c.operation === 'add') {
          entry.attributes[type] = [...(entry.attributes[type] ?? []), ...values];
        } else if (c.operation === 'delete') {
          const remaining = (entry.attributes[type] ?? []).filter(v => !values.includes(v));
          if (remaining.length > 0) entry.attributes[type] = remaining;
          else delete entry.attributes[type];
        }
      }
    },

    async del(dn: string): Promise<void> {
      const norm = normaliseDn(dn);
      if (!entries.has(norm)) {
        const err = new Error(`No such object: ${dn}`);
        err.name = 'LdapNoSuchObject';
        throw err;
      }
      entries.delete(norm);
    },

    async bulkOps(operations: ReadonlyArray<LdapBulkOp>): Promise<LdapBulkResult[]> {
      const results: LdapBulkResult[] = [];
      for (const op of operations) {
        try {
          if (op.kind === 'add') await ops.add(op.dn, op.attributes);
          else if (op.kind === 'modify') await ops.modify(op.dn, op.changes);
          else await ops.del(op.dn);
          results.push({ status: 'OK' });
        } catch (e) {
          results.push({ status: 'ERR', message: (e as Error).message });
        }
      }
      return results;
    },
  };

  return { ops, entries };
};

const makeSerializerRegistry = () => ({
  json: {
    format: { mediaType: 'application/json' } as never,
    serializeDocumentFileContents: async (content: unknown) => JSON.stringify(content),
    deserializeDocumentFileContents: async (raw: string) => JSON.parse(raw) as StorageObjectContent,
  },
});

export const ldapContractCase: StorageContractCase = {
  name: 'LdapStorageRepository',
  async makeRepo() {
    const { ops, entries } = createMockLdapOps();
    // Provision the base DN entry — real LDAP requires the base to exist.
    await ops.add(BASE_DN, { objectClass: ['top', 'organizationalUnit'], ou: 'cms' });
    void entries;
    const ds = new LdapDataSource({ ops });
    return new LdapStorageRepository({
      dataSource: ds,
      baseDn: BASE_DN,
      serializerRegistry: makeSerializerRegistry(),
      defaultFileExtension: 'json',
    });
  },
};
