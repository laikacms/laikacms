/**
 * Repository change channel — the dev-server half of Laika's hot reload.
 *
 * A {@link LaikaRepositories} storage repository can PUSH change notifications
 * (see `StorageRepository.subscribeChanges`). This module bridges those
 * notifications to a Vite dev server: when content changes on disk, the
 * matching `laika:` virtual modules are invalidated in the module graph and the
 * browser is told to reload.
 *
 * It is deliberately decoupled from `plugin.ts`: the plugin's `configureServer`
 * hook calls {@link createRepositoryChangeChannel} with its repositories and the
 * dev server, and disposes the returned handle when the server closes.
 */

import type { ChangeListener, ChangeSummary, SubscribeChangesOptions, Unsubscribe } from 'laikacms/storage';

import { type LaikaRepositories, readItem } from './backend.js';
import { bodyOf, chunkPath, writeChunk } from './bodies.js';
import { type Namespace, toVirtualId, VIRTUAL_PREFIX } from './protocol.js';

/**
 * A single node in Vite's module graph — only the members this channel touches.
 * The real `ModuleNode` is structurally compatible.
 */
export interface HmrModuleNode {
  id?: string | null | undefined;
}

/** The subset of Vite's `ModuleGraph` this channel reads. */
export interface HmrModuleGraph {
  getModuleById(id: string): HmrModuleNode | undefined;
  invalidateModule(mod: HmrModuleNode): void;
  /** Every known module keyed by resolved id. Read-only here (covariant). */
  idToModuleMap: ReadonlyMap<string, HmrModuleNode>;
}

/** A full-page reload instruction sent over Vite's HMR websocket. */
export interface HmrFullReloadPayload {
  type: 'full-reload';
  path?: string;
}

/**
 * The subset of a Vite `ViteDevServer` this channel needs. A real dev server is
 * structurally assignable, so callers pass their `ViteDevServer` directly.
 */
export interface HmrServer {
  moduleGraph: HmrModuleGraph;
  ws: { send(payload: HmrFullReloadPayload): void };
}

export interface RepositoryChangeChannelOptions {
  /**
   * When `true`, any change invalidates every resolved `laika:` virtual module
   * rather than only the ones whose keys changed. Coarser but immune to
   * cross-namespace coupling (e.g. a storage object backing a Catalog
   * document). Defaults to `false` (targeted per-key invalidation).
   */
  coarse?: boolean;
  /**
   * Set when `mdx` is enabled: the Vite root the body chunks are written under.
   * Chunks are rewritten and invalidated *before* the reload is sent, so the
   * reloaded page cannot pick up the new data module next to stale prose.
   */
  bodies?: { root: string };
}

/** The shape of a repository's `subscribeChanges`, narrowed for local use. */
type SubscribeChanges = (options: SubscribeChangesOptions, listener: ChangeListener) => Unsubscribe;

/**
 * Wire a {@link LaikaRepositories} to a Vite dev server so on-disk content
 * changes trigger HMR. Subscribes to the storage repository's push channel (and
 * any future documents push channel) when it advertises one; repositories
 * without subscription support are silently skipped.
 *
 * @returns a dispose function that removes every subscription. Idempotent.
 */
export function createRepositoryChangeChannel(
  repos: LaikaRepositories,
  server: HmrServer,
  options: RepositoryChangeChannelOptions = {},
): Unsubscribe {
  const coarse = options.coarse ?? false;
  const bodiesRoot = options.bodies?.root;
  const disposers: Unsubscribe[] = [];

  const attach = (namespace: Namespace, subscribeChanges: SubscribeChanges): void => {
    try {
      const off = subscribeChanges({}, changes => {
        if (bodiesRoot === undefined) {
          applyChanges(server, namespace, changes, coarse);
          return;
        }
        void refreshBodyChunks(repos, bodiesRoot, server, namespace, changes)
          .finally(() => applyChanges(server, namespace, changes, coarse));
      });
      disposers.push(off);
    } catch {
      // The repository does not support push subscriptions (its base
      // `subscribeChanges` throws `NotImplementedError`). Skip it — pull-based
      // backends simply don't hot-reload.
    }
  };

  attach('store', (opts, listener) => repos.storage.subscribeChanges(opts, listener));
  // The DocumentsRepository has no push channel yet; when it grows one, attach
  // it here with the 'doc' namespace.

  return () => {
    while (disposers.length > 0) {
      const off = disposers.pop();
      off?.();
    }
  };
}

/**
 * Rewrite the `.mdx` chunk of every changed item and invalidate it in the module
 * graph, so the reload that follows re-reads the prose from disk. A key that no
 * longer reads (deleted, or renamed) is skipped: its data module is about to
 * fail to resolve anyway, and the stale chunk is pruned on the next build.
 * Exported for testing.
 */
export async function refreshBodyChunks(
  repos: LaikaRepositories,
  root: string,
  server: HmrServer,
  namespace: Namespace,
  changes: readonly ChangeSummary[],
): Promise<void> {
  for (const change of changes) {
    if (change.deleted) continue;
    const id = { namespace, key: change.key };
    try {
      const { content } = await readItem(repos, id);
      const body = bodyOf(content);
      if (body === null) continue;
      await writeChunk(root, id, body);
    } catch {
      continue;
    }
    // Vite keys its module graph on POSIX-style ids.
    const mod = server.moduleGraph.getModuleById(chunkPath(root, id).replace(/\\/g, '/'));
    if (mod) server.moduleGraph.invalidateModule(mod);
  }
}

/**
 * Invalidate the affected `laika:` virtual modules and request a full reload.
 * Exported for testing.
 */
export function applyChanges(
  server: HmrServer,
  namespace: Namespace,
  changes: readonly ChangeSummary[],
  coarse: boolean,
): void {
  if (changes.length === 0) return;

  if (coarse) {
    for (const [id, mod] of server.moduleGraph.idToModuleMap) {
      if (id.startsWith(VIRTUAL_PREFIX)) server.moduleGraph.invalidateModule(mod);
    }
  } else {
    for (const change of changes) {
      const id = toVirtualId({ namespace, key: change.key });
      const mod = server.moduleGraph.getModuleById(id);
      if (mod) server.moduleGraph.invalidateModule(mod);
    }
  }

  server.ws.send({ type: 'full-reload' });
}
