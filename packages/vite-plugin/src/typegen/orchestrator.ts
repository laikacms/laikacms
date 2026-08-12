import { type LaikaRepositories, listKeys, readItem } from '../backend.js';
import { type LaikaId, type LaikaNamespace, parseLaikaId, toSource } from '../protocol.js';
import type { ContentChangeChannel } from './channel.js';
import { emitDeclarations, genericFallbackModule, type TypeScriptLoader, wrapAmbientModule } from './compiler-emit.js';
import { renderItemModule } from './renderer.js';
import { TypegenWriter } from './writer.js';

/**
 * A minimal reader over a content repository. The typegen only needs to list
 * item keys per namespace and read one item's `{ content, meta }`. In
 * production this is bound to backend.ts (`createBackendReader`); tests inject
 * an in-memory implementation.
 */
export interface TypegenReader {
  listKeys(namespace: LaikaNamespace): Promise<readonly string[]>;
  readItem(id: LaikaId): Promise<{ content: Record<string, unknown>, meta: Record<string, unknown> }>;
}

/** Binds the documented backend.ts contract to a {@link TypegenReader}. */
export function createBackendReader(repos: LaikaRepositories): TypegenReader {
  return {
    listKeys: namespace => Promise.resolve(listKeys(repos, namespace)),
    readItem: id => Promise.resolve(readItem(repos, id)),
  };
}

export interface LaikaTypegenOptions {
  /** Project root Vite serves from; all output is written under here. */
  readonly viteRoot: string;
  /** Append `as const` so literal types are preserved. Default `false`. */
  readonly literals?: boolean;
  /** Declare the `Body` export for items with prose. Mirrors the plugin's `mdx` option. */
  readonly mdx?: boolean;
  /** Namespaces to enumerate on a full regenerate. Default `['doc', 'store']`. */
  readonly namespaces?: readonly LaikaNamespace[];
  /** Debounce window (ms) for coalescing incremental writes. Default `30`. */
  readonly debounceMs?: number;
  /** Override the reader (tests / custom hosts). Defaults to backend.ts. */
  readonly reader?: TypegenReader;
  /** Repositories used when no `reader` is supplied. */
  readonly repos?: LaikaRepositories;
  /** Channel to subscribe to for incremental regeneration. */
  readonly channel?: ContentChangeChannel;
  /** Override `typescript` loading (tests simulate it being unavailable). */
  readonly tsLoader?: TypeScriptLoader;
  /** Optional diagnostic logger. */
  readonly logger?: (message: string) => void;
}

interface ItemRecord {
  readonly namespace: LaikaNamespace;
  readonly key: string;
  readonly collection: string;
  readonly block: string | null;
}

function collectionOf(key: string): string {
  const first = key.split('/')[0];
  return first.length > 0 ? first : key;
}

function toFileName(collection: string): string {
  return collection.replace(/[^A-Za-z0-9_-]+/g, '_');
}

function toTypeName(collection: string): string {
  const parts = collection.split(/[^A-Za-z0-9]+/).filter(Boolean);
  let name = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join('');
  if (name.length === 0) {
    name = 'Collection';
  }
  if (/^[0-9]/.test(name)) {
    name = `_${name}`;
  }
  return name;
}

/**
 * Stateful typegen engine. Holds the per-item declaration blocks in memory and
 * (re)writes the aggregate `.laika/vite-generated/types.d.ts` plus per-collection union
 * aliases. Safe to use one-shot (build / cold dev, no channel) or incrementally
 * (dev, driven by a {@link ContentChangeChannel}).
 */
export class LaikaTypegen {
  private readonly items = new Map<string, ItemRecord>();
  private readonly writer: TypegenWriter;
  private readonly debounceMs: number;
  private readonly namespaces: readonly LaikaNamespace[];
  private readonly channelUnsub?: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  /**
   * Tracks the most recently scheduled asynchronous work (a debounced flush,
   * or a channel-triggered `handleEvent`) so `dispose()` can drain it before
   * returning. Without this, a caller that disposes right after an emitted
   * channel event could return while a write is still in flight — and a test
   * tearing down its tmp dir immediately after could hit `ENOTEMPTY` racing
   * that write.
   */
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly options: LaikaTypegenOptions) {
    this.writer = new TypegenWriter(options.viteRoot);
    this.debounceMs = options.debounceMs ?? 30;
    this.namespaces = options.namespaces ?? ['doc', 'store'];
    if (options.channel) {
      this.channelUnsub = options.channel.subscribe(event => {
        this.pending = this.handleEvent(event).catch(error => {
          this.log(`laika typegen: channel event handling failed: ${String(error)}`);
        });
      });
    }
  }

  private log(message: string): void {
    this.options.logger?.(message);
  }

  private resolveReader(repos?: LaikaRepositories): TypegenReader | undefined {
    if (this.options.reader) {
      return this.options.reader;
    }
    const useRepos = repos ?? this.options.repos;
    return useRepos ? createBackendReader(useRepos) : undefined;
  }

  private async computeBlock(
    id: LaikaId,
    content: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<string | null> {
    const source = renderItemModule(
      { namespace: id.namespace, key: id.key, content, meta },
      { literals: this.options.literals, mdx: this.options.mdx },
    );
    const dts = await emitDeclarations(source, this.options.tsLoader);
    if (dts === null) {
      return null;
    }
    return wrapAmbientModule(toSource(id), dts);
  }

  private async handleEvent(
    event: { namespace: LaikaNamespace, key: string, kind: 'upsert' | 'delete' },
  ): Promise<void> {
    const id: LaikaId = { namespace: event.namespace, key: event.key };
    if (event.kind === 'delete') {
      await this.remove(id);
      return;
    }
    const reader = this.resolveReader();
    if (!reader) {
      this.log('laika typegen: channel upsert ignored (no reader/repos configured)');
      return;
    }
    const { content, meta } = await reader.readItem(id);
    await this.ingest(id, content, meta);
  }

  /**
   * Ingest one item's concrete `{ content, meta }` (e.g. from a Vite `load`
   * hook). Computes its declaration block and schedules a debounced write.
   */
  async ingest(id: string | LaikaId, content: Record<string, unknown>, meta: Record<string, unknown>): Promise<void> {
    const resolved = this.resolveId(id);
    const block = await this.computeBlock(resolved, content, meta);
    this.items.set(toSource(resolved), {
      namespace: resolved.namespace,
      key: resolved.key,
      collection: collectionOf(resolved.key),
      block,
    });
    await this.schedule();
  }

  /** Read one item via the reader and ingest it. */
  async regenerateItem(id: string | LaikaId, repos?: LaikaRepositories): Promise<void> {
    const resolved = this.resolveId(id);
    const reader = this.resolveReader(repos);
    if (!reader) {
      throw new Error('laika typegen: regenerateItem requires a reader or repos');
    }
    const { content, meta } = await reader.readItem(resolved);
    await this.ingest(resolved, content, meta);
  }

  /** Drop an item's types and schedule a write. */
  async remove(id: string | LaikaId): Promise<void> {
    const resolved = this.resolveId(id);
    this.items.delete(toSource(resolved));
    await this.schedule();
  }

  /**
   * Full rebuild: enumerate every item in every namespace via the reader and
   * regenerate all blocks, then flush synchronously. Works with no channel
   * (build + cold dev).
   */
  async regenerateAll(repos?: LaikaRepositories): Promise<void> {
    const reader = this.resolveReader(repos);
    if (!reader) {
      throw new Error('laika typegen: regenerateAll requires a reader or repos');
    }
    this.items.clear();
    for (const namespace of this.namespaces) {
      let keys: readonly string[];
      try {
        keys = await reader.listKeys(namespace);
      } catch (error) {
        this.log(`laika typegen: listKeys(${namespace}) failed: ${String(error)}`);
        continue;
      }
      for (const key of keys) {
        const id: LaikaId = { namespace, key };
        try {
          const { content, meta } = await reader.readItem(id);
          const block = await this.computeBlock(id, content, meta);
          this.items.set(toSource(id), { namespace, key, collection: collectionOf(key), block });
        } catch (error) {
          this.log(`laika typegen: readItem(${toSource(id)}) failed: ${String(error)}`);
        }
      }
    }
    await this.flush();
  }

  private resolveId(id: string | LaikaId): LaikaId {
    return typeof id === 'string' ? parseLaikaId(id) : id;
  }

  /**
   * With `debounceMs <= 0` this flushes immediately and the returned promise
   * resolves once the write has landed, so callers (`ingest`/`remove`) that
   * `await` it observe a fully-written filesystem before returning. With a
   * positive debounce it arms/no-ops the coalescing timer and resolves right
   * away; the eventual flush is still tracked via `this.pending` so
   * `dispose()` can drain it.
   */
  private schedule(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.debounceMs <= 0) {
      const flushed = this.flush();
      this.pending = flushed;
      return flushed;
    }
    if (this.timer) {
      return Promise.resolve();
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.pending = this.flush();
    }, this.debounceMs);
    // Do not keep the process alive solely for a pending typegen flush.
    (this.timer as { unref?: () => void }).unref?.();
    return Promise.resolve();
  }

  private buildTypes(): string {
    const blocks = [...this.items.values()]
      .filter((item): item is ItemRecord & { block: string } => item.block !== null)
      .sort((a, b) => toSource(a).localeCompare(toSource(b)))
      .map(item => item.block);
    const header = '// Generated by @laikacms/vite-plugin. Do not edit.\n\n';
    return `${header}${blocks.join('\n')}${blocks.length > 0 ? '\n' : ''}${genericFallbackModule()}`;
  }

  private buildCollections(): Map<string, string> {
    const groups = new Map<string, string[]>();
    for (const item of this.items.values()) {
      const file = toFileName(item.collection);
      const specifier = toSource({ namespace: item.namespace, key: item.key });
      const list = groups.get(file);
      if (list) {
        list.push(specifier);
      } else {
        groups.set(file, [specifier]);
      }
    }
    const files = new Map<string, string>();
    for (const [file, specifiers] of groups) {
      specifiers.sort();
      const typeName = toTypeName(file);
      const union = specifiers.map(s => `  | typeof import('${s}')`).join('\n');
      const content = [
        '// Generated by @laikacms/vite-plugin. Do not edit.',
        '//',
        `// Union of every item in the "${file}" collection, computed by the TypeScript`,
        '// compiler so a missing field on one item becomes optional across the union.',
        `// Use it to type import.meta.glob:`,
        `//   import.meta.glob<${typeName}>('/content/${file}/*')`,
        '',
        `export type ${typeName} =`,
        `${union};`,
        '',
      ].join('\n');
      files.set(file, content);
    }
    return files;
  }

  /** Force an immediate write of all outputs. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.writer.writeTypes(this.buildTypes());

    const collections = this.buildCollections();
    for (const [file, content] of collections) {
      await this.writer.writeCollection(file, content);
    }
    await this.writer.pruneCollections(new Set(collections.keys()));

    await this.writer.ensureEnvReference();
    await this.writer.ensureLaikaGitignore();
    await this.writer.ensureRootGitignore();
  }

  /** Stop listening to the channel and write any pending changes. */
  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.channelUnsub?.();
    // Drain any in-flight channel-triggered handler or debounced flush before
    // the (possibly) final flush below, so no write is left in flight once
    // dispose() resolves.
    await this.pending;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
      await this.flush();
    }
  }
}

const registry = new Map<string, LaikaTypegen>();

/** Reuse (or lazily create) a typegen instance keyed by `viteRoot`. */
function getOrCreateTypegen(options: LaikaTypegenOptions): LaikaTypegen {
  const existing = registry.get(options.viteRoot);
  if (existing) {
    return existing;
  }
  const created = new LaikaTypegen(options);
  registry.set(options.viteRoot, created);
  return created;
}

/**
 * Create a typegen handle. When `options.channel` is provided it subscribes and
 * regenerates incrementally; it also works one-shot with no channel.
 */
export function createTypegen(options: LaikaTypegenOptions): LaikaTypegen {
  const created = new LaikaTypegen(options);
  registry.set(options.viteRoot, created);
  return created;
}

/** One-shot / registry-backed full regenerate. */
export async function regenerateAll(repos: LaikaRepositories, options: LaikaTypegenOptions): Promise<void> {
  await getOrCreateTypegen(options).regenerateAll(repos);
}

/** Incremental single-item regenerate against the registry instance. */
export async function regenerateItem(
  repos: LaikaRepositories,
  id: string | LaikaId,
  options: LaikaTypegenOptions,
): Promise<void> {
  await getOrCreateTypegen(options).regenerateItem(id, repos);
}

/** Remove a single item from the registry instance. */
export async function removeItem(id: string | LaikaId, options: LaikaTypegenOptions): Promise<void> {
  await getOrCreateTypegen(options).remove(id);
}
