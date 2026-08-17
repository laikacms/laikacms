import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaikaId, LaikaNamespace } from '../protocol.js';
import type { ContentChangeChannel, ContentChangeEvent } from './channel.js';
import {
  createTypegen,
  LaikaTypegen,
  regenerateAll,
  regenerateItem,
  removeItem,
  type TypegenReader,
} from './orchestrator.js';

let workdir: string;
let contentDir: string;
let viteRoot: string;

beforeEach(async () => {
  workdir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-typegen-'));
  contentDir = path.join(workdir, 'content');
  viteRoot = path.join(workdir, 'project');
  await fs.mkdir(viteRoot, { recursive: true });
});

afterEach(async () => {
  await fs.rm(workdir, { recursive: true, force: true });
});

/** Writes a `{ content, meta }` JSON item under `content/<ns>/<key>.json`. */
async function writeItem(
  namespace: LaikaNamespace,
  key: string,
  content: Record<string, unknown>,
  meta: Record<string, unknown>,
): Promise<void> {
  const file = path.join(contentDir, namespace, `${key}.json`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ content, meta }), 'utf8');
}

/** A temp-filesystem reader over the content dir (decoupled from backend.ts). */
function fsReader(): TypegenReader {
  async function walk(dir: string, base: string): Promise<string[]> {
    let entries: Array<{ name: string, isDirectory(): boolean, isFile(): boolean }>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const keys: string[] = [];
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        keys.push(...await walk(abs, base));
      } else if (entry.name.endsWith('.json')) {
        keys.push(path.relative(base, abs).replace(/\\/g, '/').replace(/\.json$/, ''));
      }
    }
    return keys;
  }
  return {
    async listKeys(namespace) {
      const base = path.join(contentDir, namespace);
      return (await walk(base, base)).sort();
    },
    async readItem(id: LaikaId) {
      const file = path.join(contentDir, id.namespace, `${id.key}.json`);
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as {
        content: Record<string, unknown>,
        meta: Record<string, unknown>,
      };
      return raw;
    },
  };
}

async function readTypes(): Promise<string> {
  return fs.readFile(path.join(viteRoot, '.laika', 'vite-generated', 'types.d.ts'), 'utf8');
}

class TestChannel implements ContentChangeChannel {
  private readonly listeners = new Set<(event: ContentChangeEvent) => void>();
  subscribe(listener: (event: ContentChangeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event: ContentChangeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

// A repos placeholder; the injected reader is used instead in these tests.
const repos = {} as never;

describe('LaikaTypegen.regenerateAll', () => {
  it('emits exact declare module blocks + collection unions over a temp fs repo', async () => {
    await writeItem('doc', 'posts/a', { title: 'Hello', tags: ['a'] }, {
      key: 'a',
      language: 'en',
      status: 'published',
    });
    await writeItem('doc', 'posts/b', { title: 'World' }, { key: 'b', language: 'en', status: 'published' });
    await writeItem('store', 'images/logo', { url: '/logo.png' }, {
      key: 'images/logo',
      type: 'object',
      metadata: { width: 100 },
    });

    const typegen = new LaikaTypegen({ viteRoot, reader: fsReader() });
    await typegen.regenerateAll(repos);
    await typegen.dispose();

    const types = await readTypes();
    expect(types).toContain("declare module 'laika:doc/posts/a' {");
    expect(types).toContain("declare module 'laika:doc/posts/b' {");
    expect(types).toContain("declare module 'laika:store/images/logo' {");
    expect(types).toContain('export const title: string');
    expect(types).toContain('export const url: string');
    // Cold-start fallback is always present and lowest specificity.
    expect(types).toContain("declare module 'laika:*'");

    // Per-collection union alias for import.meta.glob typing.
    const postsAlias = await fs.readFile(
      path.join(viteRoot, '.laika', 'vite-generated', 'collections', 'posts.ts'),
      'utf8',
    );
    expect(postsAlias).toContain('export type Posts =');
    expect(postsAlias).toContain("| typeof import('laika:doc/posts/a')");
    expect(postsAlias).toContain("| typeof import('laika:doc/posts/b')");
    // Glob comment must use the laika: protocol, not a filesystem path.
    expect(postsAlias).toContain("import.meta.glob<Posts>('laika:doc/posts/*', { eager: true })");
    expect(postsAlias).not.toContain('/content/');
    const imagesAlias = await fs.readFile(
      path.join(viteRoot, '.laika', 'vite-generated', 'collections', 'images.ts'),
      'utf8',
    );
    expect(imagesAlias).toContain("| typeof import('laika:store/images/logo')");
    expect(imagesAlias).toContain("import.meta.glob<Images>('laika:store/images/*', { eager: true })");

    // Committed reference + ignore wiring.
    expect(await fs.readFile(path.join(viteRoot, 'laika-env.d.ts'), 'utf8')).toContain(
      '/// <reference path="./.laika/vite-generated/types.d.ts" />',
    );
    expect(await fs.readFile(path.join(viteRoot, '.gitignore'), 'utf8')).toContain('.laika/vite-generated/');
    expect(await fs.readFile(path.join(viteRoot, '.laika', '.gitignore'), 'utf8')).toBe('vite-generated/\n');
  });

  it('falls back to only the generic ambient block when typescript is unavailable', async () => {
    await writeItem('doc', 'posts/a', { title: 'Hello' }, { key: 'a', language: 'en', status: 'published' });

    const typegen = new LaikaTypegen({ viteRoot, reader: fsReader(), tsLoader: async () => null });
    await typegen.regenerateAll(repos);
    await typegen.dispose();

    const types = await readTypes();
    expect(types).toContain("declare module 'laika:*'");
    // No exact block could be emitted without the compiler.
    expect(types).not.toContain("declare module 'laika:doc/posts/a'");
  });

  it('emits only the generic fallback for an empty repo', async () => {
    const typegen = new LaikaTypegen({ viteRoot, reader: fsReader() });
    await typegen.regenerateAll(repos);
    await typegen.dispose();

    const types = await readTypes();
    expect(types).toContain("declare module 'laika:*'");
    expect(types).not.toContain("declare module 'laika:doc");
  });
});

describe('LaikaTypegen channel-driven incremental regen', () => {
  it('regenerates on upsert and drops on delete', async () => {
    await writeItem('doc', 'posts/a', { title: 'Hello' }, { key: 'a', language: 'en', status: 'published' });
    const channel = new TestChannel();
    const typegen = createTypegen({ viteRoot, reader: fsReader(), channel, debounceMs: 0 });

    channel.emit({ namespace: 'doc', key: 'posts/a', kind: 'upsert' });
    await vi.waitFor(async () => {
      expect(await readTypes()).toContain("declare module 'laika:doc/posts/a'");
    });

    channel.emit({ namespace: 'doc', key: 'posts/a', kind: 'delete' });
    await vi.waitFor(async () => {
      expect(await readTypes()).not.toContain("declare module 'laika:doc/posts/a'");
    });

    await typegen.dispose();
  });
});

describe('standalone registry helpers', () => {
  it('regenerateAll + regenerateItem + removeItem operate on one instance', async () => {
    const options = { viteRoot, reader: fsReader(), debounceMs: 0 };
    await writeItem('doc', 'posts/a', { title: 'A' }, { key: 'a', language: 'en', status: 'published' });

    await regenerateAll(repos, options);
    expect(await readTypes()).toContain("declare module 'laika:doc/posts/a'");

    await writeItem('doc', 'posts/b', { title: 'B' }, { key: 'b', language: 'en', status: 'published' });
    await regenerateItem(repos, 'doc/posts/b', options);
    await vi.waitFor(async () => {
      expect(await readTypes()).toContain("declare module 'laika:doc/posts/b'");
    });

    await removeItem('doc/posts/a', options);
    await vi.waitFor(async () => {
      expect(await readTypes()).not.toContain("declare module 'laika:doc/posts/a'");
    });
  });
});

describe('ingest', () => {
  it('renders directly from provided content/meta (no reader needed)', async () => {
    const typegen = new LaikaTypegen({ viteRoot, debounceMs: 0 });
    await typegen.ingest('doc/posts/a', { title: 'Direct' }, { key: 'a', language: 'en', status: 'published' });
    await typegen.flush();
    expect(await readTypes()).toContain('export const title: string');
    await typegen.dispose();
  });
});
