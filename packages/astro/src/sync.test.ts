import { describe, expect, it } from 'vitest';

import { type SourceRecord, toDataEntry } from './mapping.js';
import { MAPPING_VERSION, runSync, type SyncOptions, type SyncSource } from './sync.js';
import { createFakeLoaderContext, type FakeLoaderContext } from './testing/loader-context.js';

/**
 * A repository stand-in whose capabilities are configurable, so one fixture can
 * drive every tier. It also counts reads, which is how the tiers are told
 * apart: they differ in *how much they read*, not in the store they produce.
 */
function createSource(options: {
  records?: Record<string, Record<string, unknown>>,
  changes?: boolean,
  versions?: boolean,
} = {}) {
  const records = new Map<string, Record<string, unknown>>(Object.entries(options.records ?? {}));
  const versions = new Map<string, string>();
  const changeLog: Array<{ seq: number, key: string, deleted: boolean }> = [];
  let seq = 0;

  const bump = (key: string, deleted: boolean) => {
    seq += 1;
    versions.set(key, `v${seq}`);
    changeLog.push({ seq, key, deleted });
  };
  for (const key of records.keys()) bump(key, false);

  const reads = { getRecord: [] as string[], listRecords: 0, listSummaries: 0 };
  /** Every repository call in the order it was made. */
  const calls: string[] = [];

  const toRecord = (key: string): SourceRecord | undefined => {
    const content = records.get(key);
    if (content === undefined) return undefined;
    return options.versions === true
      ? { key, content, version: versions.get(key) }
      : { key, content };
  };

  const source: SyncSource = {
    capabilities: async () => ({
      changes: options.changes === true,
      versions: options.versions === true,
    }),
    listSummaries: async () => {
      calls.push('listSummaries');
      reads.listSummaries += 1;
      return [...records.keys()].map(key => ({
        key,
        version: options.versions === true ? versions.get(key) : undefined,
      }));
    },
    listRecords: async () => {
      calls.push('listRecords');
      reads.listRecords += 1;
      return [...records.keys()].map(key => toRecord(key)!);
    },
    getRecord: async key => {
      reads.getRecord.push(key);
      return toRecord(key);
    },
    getSyncToken: async () => {
      calls.push('getSyncToken');
      return String(seq);
    },
    listChanges: async token => {
      const since = Number(token);
      const latest = new Map<string, boolean>();
      for (const change of changeLog) {
        if (change.seq > since) latest.set(change.key, change.deleted);
      }
      return {
        changes: [...latest].map(([key, deleted]) => ({ key, deleted })),
        syncToken: String(seq),
      };
    },
    ownsKey: key => key.startsWith('posts/'),
  };

  return {
    source,
    reads,
    calls,
    write(key: string, content: Record<string, unknown>) {
      records.set(key, content);
      bump(key, false);
    },
    remove(key: string) {
      records.delete(key);
      bump(key, true);
    },
  };
}

function contextFor(fake: FakeLoaderContext) {
  return {
    collection: fake.collection,
    store: fake.store,
    meta: fake.meta,
    logger: fake.logger,
    entry: {},
    generateDigest: fake.generateDigest,
    refreshContextData: fake.refreshContextData,
    toEntry: (record: SourceRecord) =>
      toDataEntry(record, {
        collection: fake.collection,
        entry: {},
        render: {},
        renderMarkdown: fake.renderMarkdown,
        generateDigest: fake.generateDigest,
        parseData: fake.parseData,
      }),
  };
}

const SEED = {
  'posts/a': { title: 'A', body: '# A' },
  'posts/b': { title: 'B', body: '# B' },
};

/**
 * The behaviour every tier owes the caller, regardless of what the repository
 * advertises. Running the same expectations across all four is what makes the
 * "degrades cleanly" promise checkable rather than aspirational.
 */
const TIERS: Array<
  { name: string, strategy: SyncOptions['strategy'], capabilities: { changes?: boolean, versions?: boolean } }
> = [
  { name: 'changes', strategy: 'changes', capabilities: { changes: true, versions: true } },
  { name: 'versions', strategy: 'versions', capabilities: { versions: true } },
  { name: 'digest', strategy: 'digest', capabilities: {} },
  { name: 'reload', strategy: 'reload', capabilities: {} },
];

describe.each(TIERS)('the $name tier', ({ strategy, capabilities }) => {
  const sync = (fake: FakeLoaderContext, source: SyncSource) => runSync(source, contextFor(fake), { strategy });

  it('loads every record on a cold start', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, ...capabilities });

    await sync(fake, repo.source);

    expect([...fake.snapshot().keys()].sort()).toEqual(['a', 'b']);
    expect(fake.snapshot().get('a')?.data).toEqual({ title: 'A' });
    expect(fake.snapshot().get('a')?.rendered).toEqual({ html: '<p># A</p>' });
  });

  it('picks up a new record', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, ...capabilities });
    await sync(fake, repo.source);

    repo.write('posts/c', { title: 'C' });
    fake.resetTraffic();
    await sync(fake, repo.source);

    expect(fake.traffic.set).toContain('c');
    expect(fake.snapshot().get('c')?.data).toEqual({ title: 'C' });
  });

  it('applies an edit to an existing record', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, ...capabilities });
    await sync(fake, repo.source);

    repo.write('posts/a', { title: 'A2', body: '# A2' });
    fake.resetTraffic();
    await sync(fake, repo.source);

    expect(fake.snapshot().get('a')?.data).toEqual({ title: 'A2' });
  });

  it('removes a deleted record from the store', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, ...capabilities });
    await sync(fake, repo.source);

    repo.remove('posts/b');
    fake.resetTraffic();
    await sync(fake, repo.source);

    expect(fake.snapshot().has('b')).toBe(false);
  });
});

describe('incrementality', () => {
  it('the changes tier re-reads only what moved', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, changes: true, versions: true });
    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });

    repo.write('posts/a', { title: 'A2' });
    repo.reads.getRecord.length = 0;
    repo.reads.listRecords = 0;
    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });

    expect(repo.reads.getRecord).toEqual(['posts/a']);
    expect(repo.reads.listRecords).toBe(0);
  });

  it('the versions tier lists summaries and full-reads only what moved', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, versions: true });
    await runSync(repo.source, contextFor(fake), { strategy: 'versions' });

    repo.write('posts/a', { title: 'A2' });
    repo.reads.getRecord.length = 0;
    await runSync(repo.source, contextFor(fake), { strategy: 'versions' });

    expect(repo.reads.getRecord).toEqual(['posts/a']);
  });

  it('the digest tier writes nothing to the store when nothing changed', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), { strategy: 'digest' });

    fake.resetTraffic();
    await runSync(repo.source, contextFor(fake), { strategy: 'digest' });

    expect(fake.traffic.set).toEqual([]);
    expect(fake.traffic.delete).toEqual([]);
  });

  it('the digest tier re-parses only the record that changed', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), { strategy: 'digest' });

    repo.write('posts/a', { title: 'A2' });
    fake.resetTraffic();
    await runSync(repo.source, contextFor(fake), { strategy: 'digest' });

    expect(fake.traffic.set).toEqual(['a']);
  });

  it('the reload tier rebuilds the whole store', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), { strategy: 'reload' });

    fake.resetTraffic();
    await runSync(repo.source, contextFor(fake), { strategy: 'reload' });

    expect(fake.traffic.clear).toBe(1);
    expect(fake.traffic.set.sort()).toEqual(['a', 'b']);
  });
});

describe('tier resolution', () => {
  const strategyUsed = (fake: FakeLoaderContext) => fake.meta.get('laika:strategy');

  it('auto takes the change feed when the repository advertises one', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, changes: true, versions: true });
    await runSync(repo.source, contextFor(fake), {});
    expect(strategyUsed(fake)).toBe('changes');
  });

  it('auto falls to versions when there is no change feed', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, versions: true });
    await runSync(repo.source, contextFor(fake), {});
    expect(strategyUsed(fake)).toBe('versions');
  });

  it('auto falls to digest when the repository advertises nothing — the filesystem path', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), {});
    expect(strategyUsed(fake)).toBe('digest');
  });

  it('warns and degrades rather than throwing when an explicit tier is unsupported', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });

    expect(strategyUsed(fake)).toBe('digest');
    expect(fake.logs.filter(entry => entry.level === 'warn')).toHaveLength(1);
    expect([...fake.snapshot().keys()].sort()).toEqual(['a', 'b']);
  });
});

describe('the sync token', () => {
  it('is taken on a cold start and reused on the next run', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, changes: true });

    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });
    const first = fake.meta.get('laika:syncToken');
    expect(first).toBeDefined();

    repo.write('posts/c', { title: 'C' });
    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });

    expect(fake.meta.get('laika:syncToken')).not.toBe(first);
    expect(fake.snapshot().has('c')).toBe(true);
  });

  it('is read before the cold-start listing, so a concurrent write is replayed not lost', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, changes: true });

    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });

    // Taking the token after the listing would silently drop any write that
    // landed between the two calls. Taking it first can only ever replay one.
    expect(repo.calls).toEqual(['getSyncToken', 'listRecords']);
  });
});

describe('store invalidation', () => {
  it('clears when the collection this store was built for changed', async () => {
    const fake = createFakeLoaderContext({
      collection: 'posts',
      meta: { 'laika:collection': 'pages', 'laika:mappingVersion': MAPPING_VERSION },
      entries: [{ id: 'stale', data: {} }],
    });
    const repo = createSource({ records: SEED });

    await runSync(repo.source, contextFor(fake), {});

    expect(fake.traffic.clear).toBe(1);
    expect(fake.snapshot().has('stale')).toBe(false);
    expect([...fake.snapshot().keys()].sort()).toEqual(['a', 'b']);
  });

  it('clears when the entry mapping changed, so an upgrade cannot serve stale entries', async () => {
    const fake = createFakeLoaderContext({
      meta: { 'laika:collection': 'posts', 'laika:mappingVersion': 'ancient' },
      entries: [{ id: 'stale', data: {} }],
    });
    const repo = createSource({ records: SEED });

    await runSync(repo.source, contextFor(fake), {});

    expect(fake.traffic.clear).toBe(1);
    expect(fake.snapshot().has('stale')).toBe(false);
  });

  it('drops a sync token it can no longer trust', async () => {
    const fake = createFakeLoaderContext({
      meta: {
        'laika:collection': 'pages',
        'laika:mappingVersion': MAPPING_VERSION,
        'laika:syncToken': '99',
      },
    });
    const repo = createSource({ records: SEED, changes: true });

    await runSync(repo.source, contextFor(fake), { strategy: 'changes' });

    // A cold start after invalidation, not a resume from the stale token.
    expect([...fake.snapshot().keys()].sort()).toEqual(['a', 'b']);
    expect(fake.meta.get('laika:syncToken')).toBe('2');
  });
});

describe('pushed changes from the dev server', () => {
  it('are applied directly, without any listing', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), {});

    repo.write('posts/a', { title: 'A2' });
    repo.reads.listRecords = 0;
    repo.reads.listSummaries = 0;
    fake.resetTraffic();

    await runSync(repo.source, {
      ...contextFor(fake),
      refreshContextData: { laika: { changes: [{ key: 'posts/a', deleted: false }] } },
    }, {});

    expect(repo.reads.listRecords).toBe(0);
    expect(repo.reads.listSummaries).toBe(0);
    expect(fake.traffic.set).toEqual(['a']);
    expect(fake.snapshot().get('a')?.data).toEqual({ title: 'A2' });
  });

  it('remove the entry when the push reports a deletion', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), {});

    repo.remove('posts/b');
    fake.resetTraffic();
    await runSync(repo.source, {
      ...contextFor(fake),
      refreshContextData: { laika: { changes: [{ key: 'posts/b', deleted: true }] } },
    }, {});

    expect(fake.traffic.delete).toEqual(['b']);
  });

  it('fall back to a full sync when a key falls outside this collection', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), {});

    repo.reads.listRecords = 0;
    await runSync(repo.source, {
      ...contextFor(fake),
      // A Decap collection whose directory differs from its name produces
      // storage keys this collection cannot map. Falling back is correct;
      // guessing would risk writing the wrong entry.
      refreshContextData: { laika: { changes: [{ key: 'src/posts/a', deleted: false }] } },
    }, {});

    expect(repo.reads.listRecords).toBe(1);
  });

  it('tolerate a key that has already vanished by the time it is read', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED });
    await runSync(repo.source, contextFor(fake), {});

    fake.resetTraffic();
    await runSync(repo.source, {
      ...contextFor(fake),
      refreshContextData: { laika: { changes: [{ key: 'posts/ghost', deleted: false }] } },
    }, {});

    expect(fake.traffic.delete).toEqual(['ghost']);
  });
});

describe('digestOf integration', () => {
  it('stores the repository version as the entry digest when one exists', async () => {
    const fake = createFakeLoaderContext();
    const repo = createSource({ records: SEED, versions: true });
    await runSync(repo.source, contextFor(fake), { strategy: 'versions' });

    expect(fake.snapshot().get('a')?.digest).toBe('v1');
  });
});
