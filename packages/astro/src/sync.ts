/**
 * Keeping Astro's content store in step with a Laika repository.
 *
 * Astro's Content Layer persists its store between builds and hands the loader
 * a `meta` KV store "designed for things like sync tokens". Laika repositories
 * expose a matching pull feed — `getSyncToken` / `listChanges` — plus per-record
 * `version` tokens. Wiring the two together is most of this package's value:
 * without it, every build re-reads, re-parses and re-renders every document.
 *
 * The catch is that both Laika features are capability-gated and most backends
 * advertise neither. So rather than one strategy this module implements four,
 * ordered by how much the repository is willing to tell us, and picks the best
 * available. The bottom tier needs no capabilities at all, which means the
 * zero-config filesystem path works with no configuration and no failure mode —
 * it just does more work than a repository with a change feed would need.
 *
 * | Tier       | Requires                  | Work per build                     |
 * | ---------- | ------------------------- | ---------------------------------- |
 * | `changes`  | sync token + change feed  | only what changed                  |
 * | `versions` | version tracking          | list summaries, re-read the changed |
 * | `digest`   | nothing                   | read all, re-parse the changed     |
 * | `reload`   | nothing                   | rebuild the store                  |
 */

import type { DataStore, MetaStore } from 'astro/loaders';

import { type DataEntry, digestOf, entryIdOf, type EntryOptions, type SourceRecord } from './mapping.js';
import type { LoaderLogger } from './testing/loader-context.js';

/** How the store is brought up to date. `'auto'` picks the best tier the repository supports. */
export type SyncStrategy = 'auto' | 'changes' | 'versions' | 'digest' | 'reload';

export interface SyncOptions {
  /** Defaults to `'auto'`. */
  strategy?: SyncStrategy;
  /**
   * Whether the sync token is scoped to this collection or to the whole store.
   * A store-wide token is coarser but is the only option on repositories that
   * cannot scope a feed to a folder. Defaults to `'collection'`.
   */
  scope?: 'collection' | 'store';
}

/**
 * Bumped when the record → `DataEntry` mapping changes in a way that makes
 * previously stored entries wrong. A mismatch forces a full rebuild, so an
 * upgrade of this package can never leave a user on stale entries.
 */
export const MAPPING_VERSION = '1';

const META_SYNC_TOKEN = 'laika:syncToken';
const META_COLLECTION = 'laika:collection';
const META_STRATEGY = 'laika:strategy';
const META_MAPPING_VERSION = 'laika:mappingVersion';

/** What a change feed reports, from either the pull feed or a push subscription. */
export interface KeyChange {
  key: string;
  deleted: boolean;
}

/**
 * The repository seam the tiers work through.
 *
 * Documents and storage objects differ in listing calls and in whether they
 * have a publication state, but not in anything the sync tiers care about — so
 * both loaders implement this and share all four tiers.
 */
export interface SyncSource {
  /** Which optional tiers this repository can serve. */
  capabilities(): Promise<{ changes: boolean, versions: boolean }>;
  /** Lightweight listing; `version` is present only when the repository tracks it. */
  listSummaries(): Promise<Array<{ key: string, version?: string | undefined }>>;
  /** Full listing, content included. */
  listRecords(): Promise<SourceRecord[]>;
  /** Read one record. Resolves to `undefined` when it no longer exists. */
  getRecord(key: string): Promise<SourceRecord | undefined>;
  /** Current token for the configured scope. Only called when `capabilities().changes`. */
  getSyncToken(): Promise<string>;
  /** Changes since `token`, plus the token to resume from. */
  listChanges(token: string): Promise<{ changes: KeyChange[], syncToken: string }>;
  /**
   * Whether `key` falls inside this source's scope. Used to decide whether a
   * pushed change from the dev server can be applied directly.
   */
  ownsKey(key: string): boolean;
}

export interface SyncContext {
  collection: string;
  store: DataStore;
  meta: MetaStore;
  logger: LoaderLogger;
  entry: EntryOptions;
  generateDigest: (data: Record<string, unknown> | string) => string;
  /** Map a record to an entry. Called only for records that actually changed. */
  toEntry: (record: SourceRecord) => Promise<DataEntry>;
  refreshContextData?: Record<string, unknown> | undefined;
}

/** Bring `context.store` up to date with `source`. */
export async function runSync(
  source: SyncSource,
  context: SyncContext,
  options: SyncOptions = {},
): Promise<void> {
  const invalidated = invalidateStaleStore(context);

  // A push from the dev server already names every changed key, so there is
  // nothing to list and nothing to diff. This is what makes an edit in the CMS
  // show up immediately even on a filesystem repository, whose pull-feed
  // capabilities are both `false`.
  if (!invalidated) {
    const owned = ownedChanges(pushedChanges(context.refreshContextData), source);
    if (owned !== undefined) {
      await applyChanges(owned, source, context);
      return;
    }
  }

  const capabilities = await source.capabilities();
  const tier = resolveTier(options.strategy ?? 'auto', capabilities, context.logger);

  // A token from a previous run is only usable by the `changes` tier, and only
  // when the store it describes survived invalidation.
  const token = !invalidated && tier === 'changes' ? context.meta.get(META_SYNC_TOKEN) : undefined;

  switch (tier) {
    case 'changes':
      await syncFromChangeFeed(source, context, token);
      break;
    case 'versions':
      await syncFromVersions(source, context);
      break;
    case 'digest':
      await syncFromDigests(source, context);
      break;
    case 'reload':
      context.store.clear();
      await syncFromDigests(source, context);
      break;
  }

  context.meta.set(META_COLLECTION, context.collection);
  context.meta.set(META_MAPPING_VERSION, MAPPING_VERSION);
  context.meta.set(META_STRATEGY, tier);
}

/**
 * Drop a store that describes something other than what we are about to load.
 *
 * Reusing entries across a collection rename or a mapping change would surface
 * as content that is subtly wrong rather than absent, which is far harder to
 * notice — so both cases clear rather than attempt a merge.
 */
function invalidateStaleStore(context: SyncContext): boolean {
  const previousCollection = context.meta.get(META_COLLECTION);
  const previousMapping = context.meta.get(META_MAPPING_VERSION);
  const stale = (previousCollection !== undefined && previousCollection !== context.collection)
    || (previousMapping !== undefined && previousMapping !== MAPPING_VERSION);

  if (!stale) return false;

  context.store.clear();
  context.meta.delete(META_SYNC_TOKEN);
  return true;
}

/** Read the change batch the integration pushed through `refreshContent`. */
function pushedChanges(data: Record<string, unknown> | undefined): KeyChange[] | undefined {
  const laika = data?.['laika'];
  if (typeof laika !== 'object' || laika === null) return undefined;
  const changes = (laika as { changes?: unknown }).changes;
  if (!Array.isArray(changes) || changes.length === 0) return undefined;
  return changes.every(isKeyChange) ? changes : undefined;
}

/**
 * Narrow a pushed batch to the changes this collection can act on, or decide
 * the batch is not actionable at all.
 *
 * A push channel reports *storage* keys, and a batch routinely contains keys
 * this collection knows nothing about: sibling collections, and — on a
 * recursive filesystem watch — the directories themselves. Insisting that every
 * key be owned would mean falling back to a full listing on almost every save,
 * which defeats the point.
 *
 * So: if at least one key lands inside this collection, the repository is using
 * the identity mapping between storage keys and document keys, and the rest of
 * the batch genuinely belongs to something else — apply what we own and ignore
 * the rest. If *nothing* is owned we cannot conclude that. The batch may be
 * describing this collection through a mapping we cannot see (a Decap
 * collection whose `folder` differs from its name), so we return `undefined`
 * and let the caller do a real sync.
 */
function ownedChanges(
  pushed: KeyChange[] | undefined,
  source: SyncSource,
): KeyChange[] | undefined {
  if (pushed === undefined) return undefined;
  const owned = pushed.filter(change => source.ownsKey(change.key));
  return owned.length > 0 ? owned : undefined;
}

function isKeyChange(value: unknown): value is KeyChange {
  return typeof value === 'object' && value !== null
    && typeof (value as KeyChange).key === 'string'
    && typeof (value as KeyChange).deleted === 'boolean';
}

type Tier = Exclude<SyncStrategy, 'auto'>;

/**
 * Pick a tier.
 *
 * An explicit strategy the repository cannot serve warns and falls back rather
 * than throwing: the repository already told us what it supports through
 * `getCapabilities()`, so this is a misconfiguration to report, not a failure
 * that should stop a build.
 */
function resolveTier(
  strategy: SyncStrategy,
  capabilities: { changes: boolean, versions: boolean },
  logger: LoaderLogger,
): Tier {
  if (strategy === 'auto') {
    if (capabilities.changes) return 'changes';
    if (capabilities.versions) return 'versions';
    return 'digest';
  }
  if (strategy === 'changes' && !capabilities.changes) {
    logger.warn(
      'sync.strategy is "changes" but this repository does not advertise a change feed. '
        + 'Falling back to "digest".',
    );
    return capabilities.versions ? 'versions' : 'digest';
  }
  if (strategy === 'versions' && !capabilities.versions) {
    logger.warn(
      'sync.strategy is "versions" but this repository does not advertise version tracking. '
        + 'Falling back to "digest".',
    );
    return 'digest';
  }
  return strategy;
}

/** Tier 1 — apply the pull feed, or take a token and do a full load on a cold start. */
async function syncFromChangeFeed(
  source: SyncSource,
  context: SyncContext,
  token: string | undefined,
): Promise<void> {
  if (token === undefined) {
    // Read the token *before* listing, so a write that lands mid-load is
    // replayed on the next build rather than lost between the two calls.
    const next = await source.getSyncToken();
    await syncFromDigests(source, context);
    context.meta.set(META_SYNC_TOKEN, next);
    return;
  }

  const { changes, syncToken } = await source.listChanges(token);
  await applyChanges(changes, source, context);
  context.meta.set(META_SYNC_TOKEN, syncToken);
}

/** Tier 2 — diff the store against listed versions, then re-read only what moved. */
async function syncFromVersions(source: SyncSource, context: SyncContext): Promise<void> {
  const summaries = await source.listSummaries();
  const seen = new Set<string>();
  const stale: string[] = [];

  for (const summary of summaries) {
    const id = entryIdOf(summary.key, context.collection, context.entry);
    seen.add(id);
    const existing = context.store.get(id);
    if (existing === undefined || summary.version === undefined || existing.digest !== summary.version) {
      stale.push(summary.key);
    }
  }

  for (const key of stale) {
    const record = await source.getRecord(key);
    if (record === undefined) continue;
    context.store.set(await context.toEntry(record));
  }

  deleteMissing(context, seen);
}

/**
 * Tier 3 — read everything, but only parse and render what changed.
 *
 * The read is unavoidable without a change feed; the parse and render are the
 * expensive half, and comparing digests skips them. This is the tier the
 * filesystem and Catalog path lands on.
 */
async function syncFromDigests(source: SyncSource, context: SyncContext): Promise<void> {
  const records = await source.listRecords();
  const seen = new Set<string>();

  for (const record of records) {
    const id = entryIdOf(record.key, context.collection, context.entry);
    seen.add(id);
    const digest = digestOf(record, context.generateDigest);
    const existing = context.store.get(id);
    if (existing !== undefined && existing.digest === digest) continue;
    context.store.set(await context.toEntry(record));
  }

  deleteMissing(context, seen);
}

/** Apply a known set of changed keys without any listing. */
async function applyChanges(
  changes: readonly KeyChange[],
  source: SyncSource,
  context: SyncContext,
): Promise<void> {
  for (const change of changes) {
    const id = entryIdOf(change.key, context.collection, context.entry);
    if (change.deleted) {
      context.store.delete(id);
      continue;
    }
    // A change feed can name a key that is gone by the time we read it, and a
    // push channel can name one that was never in this collection at all.
    const record = await source.getRecord(change.key);
    if (record === undefined) {
      context.store.delete(id);
      continue;
    }
    context.store.set(await context.toEntry(record));
  }
}

/** Remove entries the repository no longer lists. */
function deleteMissing(context: SyncContext, seen: ReadonlySet<string>): void {
  for (const id of context.store.keys()) {
    if (!seen.has(id)) context.store.delete(id);
  }
}
