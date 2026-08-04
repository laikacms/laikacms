import type { ChangeListener, ChangeSummary } from 'laikacms/storage';
import { describe, expect, it } from 'vitest';

import type { LaikaRepositories } from './backend.js';
import {
  createRepositoryChangeChannel,
  type HmrFullReloadPayload,
  type HmrModuleNode,
  type HmrServer,
} from './change-channel.js';

/** A fake ViteDevServer capturing invalidations and websocket sends. */
function fakeServer() {
  const idToModuleMap = new Map<string, HmrModuleNode>();
  const invalidated: HmrModuleNode[] = [];
  const sent: HmrFullReloadPayload[] = [];
  const server: HmrServer = {
    moduleGraph: {
      getModuleById: id => idToModuleMap.get(id),
      invalidateModule: mod => {
        invalidated.push(mod);
      },
      idToModuleMap,
    },
    ws: {
      send: payload => {
        sent.push(payload);
      },
    },
  };
  const addModule = (id: string): HmrModuleNode => {
    const mod: HmrModuleNode = { id };
    idToModuleMap.set(id, mod);
    return mod;
  };
  return { server, invalidated, sent, addModule };
}

/** A fake storage-only repositories whose change listener can be triggered. */
function fakeRepos(opts: { unsupported?: boolean } = {}) {
  let listener: ChangeListener | undefined;
  const state = { unsubscribed: false };
  const storage = {
    subscribeChanges: (_options: unknown, l: ChangeListener) => {
      if (opts.unsupported) {
        throw new Error('subscribeChanges is not supported');
      }
      listener = l;
      return () => {
        state.unsubscribed = true;
        listener = undefined;
      };
    },
  };
  const repos = {
    storage,
    documents: {},
  } as unknown as LaikaRepositories;
  const trigger = (changes: ChangeSummary[]) => listener?.(changes);
  return { repos, trigger, state, isActive: () => listener !== undefined };
}

describe('createRepositoryChangeChannel', () => {
  it('invalidates the changed store module and sends a full reload', () => {
    const { server, invalidated, sent, addModule } = fakeServer();
    const mod = addModule('\0laika:store/posts/hello');
    const { repos, trigger } = fakeRepos();

    const dispose = createRepositoryChangeChannel(repos, server);
    trigger([{ key: 'posts/hello', deleted: false }]);

    expect(invalidated).toEqual([mod]);
    expect(sent).toEqual([{ type: 'full-reload' }]);

    dispose();
  });

  it('handles deletions the same way (invalidate + reload)', () => {
    const { server, invalidated, sent, addModule } = fakeServer();
    const mod = addModule('\0laika:store/posts/gone');
    const { repos, trigger } = fakeRepos();

    const dispose = createRepositoryChangeChannel(repos, server);
    trigger([{ key: 'posts/gone', deleted: true }]);

    expect(invalidated).toEqual([mod]);
    expect(sent).toHaveLength(1);

    dispose();
  });

  it('still reloads when the changed key has no module in the graph', () => {
    const { server, invalidated, sent } = fakeServer();
    const { repos, trigger } = fakeRepos();

    const dispose = createRepositoryChangeChannel(repos, server);
    trigger([{ key: 'posts/never-imported', deleted: false }]);

    expect(invalidated).toEqual([]);
    expect(sent).toEqual([{ type: 'full-reload' }]);

    dispose();
  });

  it('coarse mode invalidates every laika virtual module, leaving others alone', () => {
    const { server, invalidated, sent, addModule } = fakeServer();
    const a = addModule('\0laika:store/a');
    const b = addModule('\0laika:doc/b');
    addModule('/src/main.ts'); // non-laika module, must not be invalidated
    const { repos, trigger } = fakeRepos();

    const dispose = createRepositoryChangeChannel(repos, server, { coarse: true });
    trigger([{ key: 'a', deleted: false }]);

    expect(new Set(invalidated)).toEqual(new Set([a, b]));
    expect(invalidated).toHaveLength(2);
    expect(sent).toEqual([{ type: 'full-reload' }]);

    dispose();
  });

  it('dispose unsubscribes so later changes are ignored', () => {
    const { server, sent, addModule } = fakeServer();
    addModule('\0laika:store/x');
    const { repos, trigger, state, isActive } = fakeRepos();

    const dispose = createRepositoryChangeChannel(repos, server);
    expect(isActive()).toBe(true);

    dispose();
    expect(state.unsubscribed).toBe(true);
    expect(isActive()).toBe(false);

    trigger([{ key: 'x', deleted: false }]);
    expect(sent).toEqual([]);
  });

  it('is a no-op for repositories without a push subscription', () => {
    const { server, sent } = fakeServer();
    const { repos } = fakeRepos({ unsupported: true });

    const dispose = createRepositoryChangeChannel(repos, server);
    expect(sent).toEqual([]);
    // dispose must not throw even though nothing was subscribed.
    expect(() => dispose()).not.toThrow();
  });
});
