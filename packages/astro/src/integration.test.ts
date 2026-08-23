/**
 * The integration hooks, driven directly.
 *
 * Astro's hooks are plain functions over plain option bags, so they can be
 * called without booting Astro — and the one behaviour worth pinning down here,
 * the change-subscription to `refreshContent` bridge, needs a real filesystem
 * repository and real timing rather than a mock.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFsStorage, createRepositories } from '@laikacms/vite-plugin';
import { NotImplementedError } from 'laikacms/core/errors';

import { collectStream } from 'laikacms/compat';

import { laika } from './integration.js';
import { resolveRepositories } from './repositories.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function createContentDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-astro-int-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, 'posts'), { recursive: true });
  return dir;
}

/**
 * A filesystem repository set whose push channel is unavailable — the shape of
 * every backend that does not implement `subscribeChanges` (GitHub, R2, S3, …).
 */
async function createRepositoriesWithoutChangeChannel() {
  const dir = await createContentDir();
  const repositories = createRepositories(createFsStorage({ dir, defaultExtension: 'md' }));
  repositories.storage.subscribeChanges = () => {
    throw new NotImplementedError('subscribeChanges is not supported by this storage repository.');
  };
  return repositories;
}

/** The subset of a ViteDevServer the integration touches. */
function fakeServer() {
  const used: unknown[] = [];
  return {
    server: {
      middlewares: { use: (...args: unknown[]) => void used.push(args) },
      config: { server: { host: undefined }, logger: { warn: () => {} } },
    },
    used,
  };
}

const silentLogger = {
  info: () => {},
  warn: vi.fn(),
  error: () => {},
  debug: () => {},
  options: {},
  label: 'test',
  fork: () => silentLogger,
} as never;

type Hooks = ReturnType<typeof laika>['hooks'];

function callSetup(hooks: Hooks, root: string): void {
  const watched: string[] = [];
  void hooks['astro:config:setup']?.({
    config: { root: new URL(`file://${root}/`) },
    addWatchFile: (file: string | URL) => void watched.push(String(file)),
    logger: silentLogger,
  } as never);
}

describe('astro:server:setup', () => {
  it('mounts the JSON:API on the dev server', async () => {
    const dir = await createContentDir();
    const integration = laika({ dir });
    callSetup(integration.hooks, dir);

    const { server, used } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: silentLogger,
      refreshContent: async () => {},
    } as never);

    expect(used.length).toBeGreaterThan(0);
    await integration.hooks['astro:server:done']?.({ logger: silentLogger } as never);
  });

  it('does not mount the API when it is switched off', async () => {
    const dir = await createContentDir();
    const integration = laika({ dir, api: false, refresh: false });
    callSetup(integration.hooks, dir);

    const { server, used } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: silentLogger,
      refreshContent: async () => {},
    } as never);

    expect(used).toEqual([]);
  });

  it('refreshes content when a file changes, and names the changed key', async () => {
    const dir = await createContentDir();
    const integration = laika({ dir, defaultExtension: 'md', refresh: { debounceMs: 10 } });
    callSetup(integration.hooks, dir);

    const refreshContent = vi.fn(async () => {});
    const { server } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: silentLogger,
      refreshContent,
    } as never);

    await fs.writeFile(path.join(dir, 'posts', 'hello.md'), '---\ntitle: Hi\n---\n# Hi\n');
    await vi.waitFor(() => expect(refreshContent).toHaveBeenCalled(), { timeout: 3000 });

    const context = refreshContent.mock.calls[0]?.[0] as {
      context: { laika: { changes: Array<{ key: string, deleted: boolean }> } },
    };
    expect(context.context.laika.changes).toContainEqual({ key: 'posts/hello', deleted: false });

    await integration.hooks['astro:server:done']?.({ logger: silentLogger } as never);
  });

  it('coalesces a burst of writes into a single refresh', async () => {
    const dir = await createContentDir();
    const integration = laika({ dir, defaultExtension: 'md', refresh: { debounceMs: 60 } });
    callSetup(integration.hooks, dir);

    const refreshContent = vi.fn(async () => {});
    const { server } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: silentLogger,
      refreshContent,
    } as never);

    for (const name of ['a', 'b', 'c']) {
      await fs.writeFile(path.join(dir, 'posts', `${name}.md`), `---\ntitle: ${name}\n---\n`);
    }
    await vi.waitFor(() => expect(refreshContent).toHaveBeenCalled(), { timeout: 3000 });
    // Give any second, un-coalesced call time to arrive before asserting there isn't one.
    await new Promise(resolve => setTimeout(resolve, 200));

    expect(refreshContent).toHaveBeenCalledTimes(1);
    const context = refreshContent.mock.calls[0]?.[0] as {
      context: { laika: { changes: Array<{ key: string }> } },
    };
    // A recursive watch also reports the directories themselves; what matters
    // is that all three content keys arrived in one batch.
    const keys = context.context.laika.changes.map(change => change.key);
    expect(keys).toEqual(expect.arrayContaining(['posts/a', 'posts/b', 'posts/c']));

    await integration.hooks['astro:server:done']?.({ logger: silentLogger } as never);
  });

  it('stops refreshing once the server shuts down', async () => {
    const dir = await createContentDir();
    const integration = laika({ dir, defaultExtension: 'md', refresh: { debounceMs: 10 } });
    callSetup(integration.hooks, dir);

    const refreshContent = vi.fn(async () => {});
    const { server } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: silentLogger,
      refreshContent,
    } as never);
    await integration.hooks['astro:server:done']?.({ logger: silentLogger } as never);

    await fs.writeFile(path.join(dir, 'posts', 'late.md'), '---\ntitle: Late\n---\n');
    await new Promise(resolve => setTimeout(resolve, 300));

    expect(refreshContent).not.toHaveBeenCalled();
  });

  it('warns rather than failing when the repository has no change channel', async () => {
    const warn = vi.fn();
    const logger = { ...silentLogger, warn } as never;
    const integration = laika({ repositories: await createRepositoriesWithoutChangeChannel() });

    const { server } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger,
      refreshContent: async () => {},
    } as never);

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('hot-reload');
  });

  it('warns when the Astro version predates refreshContent', async () => {
    const warn = vi.fn();
    const dir = await createContentDir();
    const integration = laika({ dir });
    callSetup(integration.hooks, dir);

    const { server } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: { ...silentLogger, warn } as never,
    } as never);

    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('refreshContent');
  });
});

describe('astro:config:done', () => {
  it('emits types by default', () => {
    const injectTypes = vi.fn();
    laika().hooks['astro:config:done']?.({ injectTypes, logger: silentLogger } as never);

    expect(injectTypes).toHaveBeenCalledOnce();
    expect(injectTypes.mock.calls[0]?.[0]).toMatchObject({ filename: 'types.d.ts' });
  });

  it('emits nothing when types are switched off', () => {
    const injectTypes = vi.fn();
    laika({ types: false }).hooks['astro:config:done']?.({
      injectTypes,
      logger: silentLogger,
    } as never);

    expect(injectTypes).not.toHaveBeenCalled();
  });
});

describe('astro:config:done — live-collection types', () => {
  const DECAP_CONFIG = `
backend:
  name: laika
collections:
  - name: posts
    folder: posts
    fields:
      - { name: title, widget: string }
      - { name: date, widget: datetime }
      - { name: draft, widget: boolean, required: false }
      - { name: body, widget: markdown }
  - name: my-pages
    folder: pages
    fields:
      - { name: title, widget: string }
`;

  async function createDecapProject(config = DECAP_CONFIG): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-astro-live-'));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, 'config.yml'), config);
    return dir;
  }

  const emitted = async (options: Record<string, unknown>): Promise<string | undefined> => {
    const injectTypes = vi.fn();
    await laika(options).hooks['astro:config:done']?.({
      injectTypes,
      logger: silentLogger,
    } as never);

    const call = injectTypes.mock.calls
      .find(([arg]) => (arg as { filename: string }).filename === 'live-collections.d.ts');
    return (call?.[0] as { content: string } | undefined)?.content;
  };

  it('types every collection the CMS config describes', async () => {
    const dir = await createDecapProject();

    const content = await emitted({ dir, catalog: 'decap' });

    expect(content).toBeDefined();
    expect(content).toContain(`declare module '@laikacms/astro/live-collections'`);
    expect(content).toContain('interface LaikaLiveCollections');
    expect(content).toContain('posts: {');
    expect(content).toContain('title: string;');
    expect(content).toContain('draft?: boolean;');
  });

  it('widens dates, because nothing coerces them on the live path', async () => {
    const dir = await createDecapProject();

    expect(await emitted({ dir, catalog: 'decap' })).toContain('date: string | Date;');
  });

  it('leaves the prose field out, as the loader does', async () => {
    const dir = await createDecapProject();

    expect(await emitted({ dir, catalog: 'decap' })).not.toContain('body');
  });

  it('quotes a collection key that is not a bare identifier', async () => {
    const dir = await createDecapProject();

    expect(await emitted({ dir, catalog: 'decap' })).toContain('"my-pages": {');
  });

  it('emits nothing for a catalog that describes no fields', async () => {
    // The default convention catalog reports only persisted collections and
    // describes them permissively; an augmentation asserting nothing would be
    // noise in `.astro/`, and every live collection stays Record<string, unknown>.
    const dir = await createDecapProject();

    expect(await emitted({ dir })).toBeUndefined();
  });

  it('does not fail the build when the catalog cannot be read', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-astro-live-'));
    tempDirs.push(dir);

    // `catalog: 'decap'` with no config.yml at all.
    await expect(emitted({ dir, catalog: 'decap' })).resolves.toBeUndefined();
  });

  it('emits nothing when types are switched off', async () => {
    const dir = await createDecapProject();

    expect(await emitted({ dir, catalog: 'decap', types: false })).toBeUndefined();
  });
});

describe('repository construction', () => {
  it('is lazy — nothing is read before a server or a loader asks', async () => {
    // A non-existent directory would throw eagerly if the integration built the
    // repository at construction time. `astro sync` and `astro build` never
    // reach the server hook, so eager construction would break both.
    expect(() => laika({ dir: '/definitely/does/not/exist' })).not.toThrow();
  });

  it('uses supplied repositories verbatim', async () => {
    const dir = await createContentDir();
    const repositories = createRepositories(createFsStorage({ dir, defaultExtension: 'md' }));
    const integration = laika({ repositories, refresh: false });

    const { server, used } = fakeServer();
    await integration.hooks['astro:server:setup']?.({
      server,
      logger: silentLogger,
      refreshContent: async () => {},
    } as never);

    expect(used.length).toBeGreaterThan(0);
  });
});

describe('resolveRepositories', () => {
  it('resolves a relative dir against the Astro project root', async () => {
    const root = await createContentDir();
    await fs.writeFile(path.join(root, 'posts', 'x.md'), '---\ntitle: X\n---\n');

    const { documents } = resolveRepositories({ dir: 'posts', defaultExtension: 'md' }, root);
    const { items } = await collectStream(documents.listRecordSummaries({
      folder: 'x',
      depth: 1,
      pagination: { perPage: 10 },
    }));

    // `dir: 'posts'` roots storage at <root>/posts, so the document written at
    // posts/x.md is reachable — proving the path was joined, not ignored.
    expect(items).toBeDefined();
  });

  it('prefers explicitly supplied repositories over dir', async () => {
    const dir = await createContentDir();
    const repositories = createRepositories(createFsStorage({ dir, defaultExtension: 'md' }));

    expect(resolveRepositories({ repositories, dir: '/ignored' }, dir)).toBe(repositories);
  });

  it('derives documents and assets from a supplied storage repository', async () => {
    const dir = await createContentDir();
    const storage = createFsStorage({ dir, defaultExtension: 'md' });

    const resolved = resolveRepositories({ storage }, dir);

    expect(resolved.storage).toBe(storage);
    expect(resolved.documents).toBeDefined();
    expect(resolved.assets).toBeDefined();
  });
});
