import { LaikaStream, LaikaTask, NotFoundError } from 'laikacms/core';
import { runStorageRepositoryContract } from 'laikacms/storage/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ldapContractCase } from './testing/index.js';

runStorageRepositoryContract(ldapContractCase);

import {
  andFilter,
  buildDn,
  eqFilter,
  type LdapBulkOp,
  type LdapBulkResult,
  LdapDataSource,
  type LdapEntry,
  type LdapModifyChange,
  type LdapOps,
  type LdapSearchOptions,
  orFilter,
  parseDn,
} from './ldap-datasource.js';
import { LdapStorageRepository } from './ldap-storage-repository.js';

// ---------------------------------------------------------------------------
// In-memory LDAP mock.
//
// Implements `LdapOps` directly — no wire format. The interesting bit is
// the recursive-descent LDAP search-filter parser, which evaluates the
// actual filter strings the repository emits:
//
//   (objectClass=laikaFile)
//   (cn=hello.md)
//   (&(objectClass=laikaFile)(|(cn=hello.md)(cn=hello.json)))
//   (objectClass=*)
//
// Errors are signalled the way real LDAP clients do — Errors tagged with
// `name: 'LdapNoSuchObject'` / `'LdapEntryAlreadyExists'`.
// ---------------------------------------------------------------------------

const BASE_DN = 'ou=cms,dc=example,dc=com';

interface StoredEntry {
  dn: string;
  attributes: Record<string, string[]>;
}

let entries: Map<string, StoredEntry>; // keyed by DN (case-insensitive normalised)
let searchCount: number;
let bulkOpsCount: number;
let lastFilter: string | null = null;

const normaliseDn = (dn: string): string => dn.toLowerCase().replace(/\s*,\s*/g, ',').trim();

// ---- Filter parser -------------------------------------------------------

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
  const expect = (ch: string) => {
    if (input[pos] !== ch) throw new Error(`expected '${ch}' at ${pos} in ${input}`);
    pos += 1;
  };

  const parse = (): Filter => {
    skipWs();
    expect('(');
    skipWs();
    const ch = input[pos];
    if (ch === '&') {
      pos += 1;
      const fs: Filter[] = [];
      while (input[pos] !== ')') fs.push(parse());
      expect(')');
      return { kind: 'and', filters: fs };
    }
    if (ch === '|') {
      pos += 1;
      const fs: Filter[] = [];
      while (input[pos] !== ')') fs.push(parse());
      expect(')');
      return { kind: 'or', filters: fs };
    }
    if (ch === '!') {
      pos += 1;
      const inner = parse();
      expect(')');
      return { kind: 'not', filter: inner };
    }
    // Simple `attr=value` (or `attr=*` for presence).
    let attr = '';
    while (pos < input.length && input[pos] !== '=' && input[pos] !== ')') {
      attr += input[pos];
      pos += 1;
    }
    expect('=');
    let value = '';
    while (pos < input.length && input[pos] !== ')') {
      value += input[pos];
      pos += 1;
    }
    expect(')');
    if (value === '*') return { kind: 'present', attr };
    // Decode the standard LDAP escape sequences (\28, \29, \2a, \5c).
    const decoded = value
      .replace(/\\28/g, '(').replace(/\\29/g, ')')
      .replace(/\\2a/g, '*').replace(/\\5c/g, '\\');
    return { kind: 'eq', attr, value: decoded, hasWildcard: decoded.includes('*') };
  };

  return parse();
};

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

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---- DN parent helper ---------------------------------------------------

const parentDnOf = (dn: string): string => {
  const idx = dn.indexOf(',');
  return idx === -1 ? '' : dn.slice(idx + 1);
};

// ---- Mock LdapOps implementation ----------------------------------------

const mockOps: LdapOps = {
  async search(options: LdapSearchOptions): Promise<LdapEntry[]> {
    searchCount += 1;
    lastFilter = options.filter;
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
      // sub
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

  async bulkOps(ops: ReadonlyArray<LdapBulkOp>): Promise<LdapBulkResult[]> {
    bulkOpsCount += 1;
    const results: LdapBulkResult[] = [];
    for (const op of ops) {
      try {
        if (op.kind === 'add') await this.add(op.dn, op.attributes);
        else if (op.kind === 'modify') await this.modify(op.dn, op.changes);
        else await this.del(op.dn);
        results.push({ status: 'OK' });
      } catch (e) {
        results.push({ status: 'ERR', message: (e as Error).message });
      }
    }
    return results;
  },
};

// ---------------------------------------------------------------------------
// Serializer registry
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

const makeRepo = (): LdapStorageRepository => {
  const ds = new LdapDataSource({ ops: mockOps });
  return new LdapStorageRepository({
    dataSource: ds,
    baseDn: BASE_DN,
    serializerRegistry: serializerRegistry as never,
    defaultFileExtension: 'md',
  });
};

beforeEach(() => {
  entries = new Map();
  searchCount = 0;
  bulkOpsCount = 0;
  lastFilter = null;
  // Provision the base DN entry — real LDAP requires the base to exist.
  mockOps.add(BASE_DN, { objectClass: ['top', 'organizationalUnit'], ou: 'cms' });
});

afterEach(() => {
  entries.clear();
});

// ---------------------------------------------------------------------------
// Helper tests
// ---------------------------------------------------------------------------

describe('buildDn / parseDn', () => {
  it('round-trips RDNs in LDAP right-to-left order', () => {
    const dn = buildDn(BASE_DN, [['ou', 'notes'], ['cn', 'hello.md']]);
    expect(dn).toBe(`cn=hello.md,ou=notes,${BASE_DN}`);
    const parsed = parseDn(dn);
    expect(parsed.map(r => `${r.attribute}=${r.value}`)).toEqual([
      'cn=hello.md',
      'ou=notes',
      'ou=cms',
      'dc=example',
      'dc=com',
    ]);
  });

  it('escapes RDN values per RFC 4514', () => {
    const dn = buildDn(BASE_DN, [['cn', 'name,with=special;chars']]);
    // Escaped chars: `,` → `\,`, `=` → `\=`, `;` → `\;`.
    expect(dn).toBe(`cn=name\\,with\\=special\\;chars,${BASE_DN}`);
  });
});

describe('LDAP filter builders', () => {
  it('builds equality, AND, OR filters', () => {
    expect(eqFilter('cn', 'hello')).toBe('(cn=hello)');
    expect(eqFilter('cn', 'with*star')).toBe('(cn=with\\2astar)');
    expect(andFilter(eqFilter('cn', 'a'), eqFilter('ou', 'b')))
      .toBe('(&(cn=a)(ou=b))');
    expect(orFilter(eqFilter('cn', 'a'), eqFilter('cn', 'b')))
      .toBe('(|(cn=a)(cn=b))');
  });
});

// ---------------------------------------------------------------------------
// Repository tests
// ---------------------------------------------------------------------------

describe('LdapStorageRepository', () => {
  it('createObject stores an entry at the right DN with the right objectClass', async () => {
    const repo = makeRepo();
    const created = await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    expect(created.key).toBe('notes/hello');
    expect(created.metadata?.extension).toBe('md');
    // DN surfaces as revisionId.
    expect(created.metadata?.revisionId).toBe(`cn=hello.md,ou=notes,${BASE_DN}`);

    // Verify the on-wire entry.
    const stored = entries.get(normaliseDn(`cn=hello.md,ou=notes,${BASE_DN}`));
    expect(stored?.attributes['objectClass']).toEqual(['top', 'laikaFile']);
    expect(stored?.attributes['cn']).toEqual(['hello.md']);
    expect(stored?.attributes['laikaParent']).toEqual(['notes']);
    expect(stored?.attributes['laikaExtension']).toEqual(['md']);
    expect(stored?.attributes['laikaContent']).toEqual(['hi']);

    const fetched = await LaikaTask.runPromise(repo.getObject('notes/hello'));
    expect(fetched.content).toEqual({ body: 'hi' });
  });

  it('createObject auto-creates ancestor OUs (LDAP requires parent entries to exist)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'a/b/c/deep', content: { body: 'x' } }),
    );
    // All three intermediate OUs were materialised.
    expect(entries.has(normaliseDn(`ou=a,${BASE_DN}`))).toBe(true);
    expect(entries.has(normaliseDn(`ou=b,ou=a,${BASE_DN}`))).toBe(true);
    expect(entries.has(normaliseDn(`ou=c,ou=b,ou=a,${BASE_DN}`))).toBe(true);
    // And the leaf file.
    expect(entries.has(normaliseDn(`cn=deep.md,ou=c,ou=b,ou=a,${BASE_DN}`))).toBe(true);
  });

  it('extension-free key resolution uses a single OR-filter search', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/hello', content: { body: 'hi' } }),
    );
    searchCount = 0;
    lastFilter = null;
    await LaikaTask.runPromise(repo.getObject('notes/hello'));
    // The repository emits a single search with the OR'd cn filter.
    // We have md + json registered as extensions.
    expect(lastFilter).toBe('(&(objectClass=laikaFile)(|(cn=hello.md)(cn=hello.json)))');
    expect(searchCount).toBe(1);
  });

  it('createObject rejects duplicates via LdapEntryAlreadyExists → EntryAlreadyExistsError', async () => {
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

  it('updateObject uses `replace` operation in modify()', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/x', content: { body: 'a' } }),
    );
    await LaikaTask.runPromise(
      repo.updateObject({ key: 'notes/x', content: { body: 'b' } }),
    );
    const stored = entries.get(normaliseDn(`cn=x.md,ou=notes,${BASE_DN}`));
    expect(stored?.attributes['laikaContent']).toEqual(['b']);
  });

  it('removeAtoms ships as ONE bulkOps call with N `del` actions', async () => {
    const repo = makeRepo();
    for (const k of ['a', 'b', 'c']) {
      await LaikaTask.runPromise(
        repo.createObject({ type: 'object', key: `notes/${k}`, content: { body: k } }),
      );
    }
    bulkOpsCount = 0;
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/b', 'notes/c']),
    );
    expect(removed.done).toEqual({ removed: 3, skipped: 0 });
    expect(removed.data.sort()).toEqual(['notes/a', 'notes/b', 'notes/c']);
    // *The* distinctive trait — exactly one bulkOps call regardless of N.
    expect(bulkOpsCount).toBe(1);
    // Files gone; ancestor OUs preserved.
    expect(entries.has(normaliseDn(`cn=a.md,ou=notes,${BASE_DN}`))).toBe(false);
    expect(entries.has(normaliseDn(`ou=notes,${BASE_DN}`))).toBe(true);
  });

  it('removeAtoms reports missing keys as skipped without aborting', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(
      repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }),
    );
    const removed = await LaikaStream.runPromiseCollect(
      repo.removeAtoms(['notes/a', 'notes/nope']),
    );
    expect(removed.done).toEqual({ removed: 1, skipped: 1 });
    expect(removed.recoverableErrors[0]).toBeInstanceOf(NotFoundError);
  });

  it('listAtomSummaries uses scope=one against the parent OU', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/a', content: { body: 'a' } }));
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/b', content: { body: 'b' } }));
    // A deeper file (`notes/sub/c`) creates an `ou=sub` OU.
    await LaikaTask.runPromise(repo.createObject({ type: 'object', key: 'notes/sub/c', content: { body: 'c' } }));

    const collected = await LaikaStream.runPromiseCollect(
      repo.listAtomSummaries('notes', { pagination: PAGE }),
    );
    const types = collected.data.reduce((acc, s) => {
      acc[s.key] = s.type;
      return acc;
    }, {} as Record<string, string>);
    expect(types).toEqual({
      'notes/a': 'object-summary',
      'notes/b': 'object-summary',
      'notes/sub': 'folder-summary',
    });
    // `notes/sub/c` is NOT a child of `notes` directly — should not appear.
  });

  it('createFolder creates an OU entry', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'empty' }));
    const stored = entries.get(normaliseDn(`ou=empty,${BASE_DN}`));
    expect(stored?.attributes['objectClass']).toEqual(['top', 'organizationalUnit', 'laikaFolder']);
    const folder = await LaikaTask.runPromise(repo.getFolder('empty'));
    expect(folder.type).toBe('folder');
  });

  it('createFolder is idempotent (LdapEntryAlreadyExists swallowed)', async () => {
    const repo = makeRepo();
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    await LaikaTask.runPromise(repo.createFolder({ type: 'folder', key: 'twice' }));
    // Just the one entry — no duplicate, no error.
    expect([...entries.keys()].filter(k => k.startsWith('ou=twice,'))).toHaveLength(1);
  });

  it('getFolder fails for a missing OU', async () => {
    const repo = makeRepo();
    await expect(LaikaTask.runPromise(repo.getFolder('nowhere'))).rejects.toThrow(/not found/i);
  });

  it('filter escaping protects against LDAP injection via filenames', async () => {
    // A filename with parens / asterisk / backslash should be escaped per
    // RFC 4515 in the filter sent over the wire.
    const repo = makeRepo();
    await LaikaTask.runPromise(
      // Note: cn doesn't allow special chars by default in some LDAP servers;
      // but we *test* the filter escaping behaviour by including a
      // *star* in the name. Our escape produces \2a — the parser decodes it.
      repo.createObject({ type: 'object', key: 'a*b', content: { body: 'x' } }),
    );
    searchCount = 0;
    lastFilter = null;
    await LaikaTask.runPromise(repo.getObject('a*b'));
    // The wire filter must escape `*` so it isn't interpreted as wildcard.
    expect(lastFilter).toContain('\\2a');
    expect(lastFilter).not.toMatch(/cn=a\*b\./); // unescaped form must not appear
  });
});
