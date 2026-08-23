/**
 * A `LoaderContext` backed by plain Maps, for testing loaders without booting
 * Astro.
 *
 * Astro constructs the real context inside its content sync pipeline, so there
 * is no supported way to obtain one in a unit test. Everything a loader touches
 * is small and side-effect free, which makes a faithful stand-in cheap — and
 * lets the loader tests assert on *store traffic* (`set` / `delete` counts),
 * which is the property that actually distinguishes the sync tiers.
 *
 * Exported from `@laikacms/astro/testing` so a future framework adapter with the
 * same loader shape can reuse it rather than growing a second copy.
 */

import type { DataStore, MetaStore } from 'astro/loaders';

import type { DataEntry } from '../mapping.js';

/** The subset of `AstroIntegrationLogger` a loader is allowed to use. */
export interface LoaderLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  debug(message: string): void;
}

/** A record of every mutation a loader performed, in order. */
export interface StoreTraffic {
  set: string[];
  delete: string[];
  clear: number;
  addModuleImport: string[];
}

export interface FakeLoaderContext {
  collection: string;
  store: DataStore;
  meta: MetaStore;
  logger: LoaderLogger;
  generateDigest(data: Record<string, unknown> | string): string;
  renderMarkdown(content: string): Promise<{ html: string, metadata?: Record<string, unknown> }>;
  parseData<TData extends Record<string, unknown>>(props: { id: string, data: TData }): Promise<TData>;
  refreshContextData?: Record<string, unknown>;

  /** Mutations recorded since the last {@link resetTraffic}. */
  traffic: StoreTraffic;
  /** Clear {@link traffic} — call between two `load()` runs to isolate the second. */
  resetTraffic(): void;
  /** Every log line emitted, tagged by level. */
  logs: Array<{ level: keyof LoaderLogger, message: string }>;
  /** The entries currently in the store, keyed by id. */
  snapshot(): Map<string, DataEntry>;
}

export interface FakeLoaderContextOptions {
  collection?: string;
  /** Seed the meta store, e.g. with a sync token from a previous run. */
  meta?: Record<string, string>;
  /** Seed the data store, e.g. to simulate a warm build. */
  entries?: DataEntry[];
  /** Value surfaced as `refreshContextData`. */
  refreshContextData?: Record<string, unknown>;
}

/**
 * Build a {@link FakeLoaderContext}.
 *
 * `parseData` is the identity function — schema validation is Astro's job and
 * is covered by Astro's own tests; what these tests care about is *that* it was
 * called, and with which id.
 */
export function createFakeLoaderContext(
  options: FakeLoaderContextOptions = {},
): FakeLoaderContext {
  const entries = new Map<string, DataEntry>();
  for (const entry of options.entries ?? []) entries.set(entry.id, entry);
  const metaEntries = new Map<string, string>(Object.entries(options.meta ?? {}));

  const traffic: StoreTraffic = { set: [], delete: [], clear: 0, addModuleImport: [] };
  const logs: Array<{ level: keyof LoaderLogger, message: string }> = [];

  const store: DataStore = {
    get<TData extends Record<string, unknown> = Record<string, unknown>>(key: string) {
      return entries.get(key) as (DataEntry & { data: TData }) | undefined;
    },
    entries: () => [...entries.entries()],
    set: entry => {
      traffic.set.push(entry.id);
      entries.set(entry.id, entry as DataEntry);
      return true;
    },
    values: () => [...entries.values()],
    keys: () => [...entries.keys()],
    delete: (key: string) => {
      traffic.delete.push(key);
      entries.delete(key);
    },
    clear: () => {
      traffic.clear += 1;
      entries.clear();
    },
    has: (key: string) => entries.has(key),
    addModuleImport: (fileName: string) => {
      traffic.addModuleImport.push(fileName);
    },
  };

  const meta: MetaStore = {
    get: (key: string) => metaEntries.get(key),
    set: (key: string, value: string) => {
      metaEntries.set(key, value);
    },
    has: (key: string) => metaEntries.has(key),
    delete: (key: string) => {
      metaEntries.delete(key);
    },
  };

  const log = (level: keyof LoaderLogger) => (message: string) => {
    logs.push({ level, message });
  };

  return {
    collection: options.collection ?? 'posts',
    store,
    meta,
    logger: { info: log('info'), warn: log('warn'), error: log('error'), debug: log('debug') },
    generateDigest: data => fakeDigest(typeof data === 'string' ? data : JSON.stringify(data)),
    renderMarkdown: async content => ({ html: `<p>${content}</p>` }),
    parseData: async ({ data }) => data,
    ...(options.refreshContextData !== undefined
      ? { refreshContextData: options.refreshContextData }
      : {}),
    traffic,
    resetTraffic: () => {
      traffic.set.length = 0;
      traffic.delete.length = 0;
      traffic.clear = 0;
      traffic.addModuleImport.length = 0;
    },
    logs,
    snapshot: () => new Map(entries),
  };
}

/**
 * A stable, cheap, non-cryptographic hash. Astro's real `generateDigest` has
 * the same contract — equal input, equal output; nothing else is promised.
 */
function fakeDigest(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}
