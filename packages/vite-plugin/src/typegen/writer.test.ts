import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TypegenWriter } from './writer.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-writer-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('TypegenWriter', () => {
  it('writes types.d.ts under .laika/vite-generated/', async () => {
    const writer = new TypegenWriter(root);
    const changed = await writer.writeTypes('// types\n');
    expect(changed).toBe(true);
    expect(await fs.readFile(path.join(root, '.laika', 'vite-generated', 'types.d.ts'), 'utf8')).toBe('// types\n');
  });

  it('skips a no-op rewrite (identical content)', async () => {
    const writer = new TypegenWriter(root);
    await writer.writeTypes('same\n');
    const changedAgain = await writer.writeTypes('same\n');
    expect(changedAgain).toBe(false);
  });

  it('creates laika-env.d.ts once and never clobbers a user-modified file', async () => {
    const writer = new TypegenWriter(root);
    const created = await writer.ensureEnvReference();
    expect(created).toBe(true);
    expect(await fs.readFile(path.join(root, 'laika-env.d.ts'), 'utf8')).toBe(
      '/// <reference path="./.laika/vite-generated/types.d.ts" />\n',
    );

    // Simulate a user edit; ensure it is preserved.
    await fs.writeFile(path.join(root, 'laika-env.d.ts'), 'CUSTOM CONTENT\n', 'utf8');
    const createdAgain = await writer.ensureEnvReference();
    expect(createdAgain).toBe(false);
    expect(await fs.readFile(path.join(root, 'laika-env.d.ts'), 'utf8')).toBe('CUSTOM CONTENT\n');
  });

  it('ignores only the generated subtree, never .laika/ itself', async () => {
    const writer = new TypegenWriter(root);
    await fs.writeFile(path.join(root, '.gitignore'), 'node_modules\n', 'utf8');

    expect(await writer.ensureRootGitignore()).toBe(true);
    const gitignore = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
    expect(gitignore).toContain('node_modules');
    expect(gitignore).toContain('.laika/vite-generated/');
    // A bare `.laika/` rule would swallow the catalog, schemas and revisions.
    expect(gitignore.split(/\r?\n/).map(l => l.trim())).not.toContain('.laika/');

    // Idempotent.
    expect(await writer.ensureRootGitignore()).toBe(false);

    await writer.ensureLaikaGitignore();
    expect(await fs.readFile(path.join(root, '.laika', '.gitignore'), 'utf8')).toBe(
      'vite-generated/\n',
    );
  });

  it('creates .gitignore when absent', async () => {
    const writer = new TypegenWriter(root);
    expect(await writer.ensureRootGitignore()).toBe(true);
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toContain(
      '.laika/vite-generated/',
    );
  });

  it('prunes stale collection files', async () => {
    const writer = new TypegenWriter(root);
    await writer.writeCollection('posts', 'export type Posts = never;\n');
    await writer.writeCollection('pages', 'export type Pages = never;\n');

    const removed = await writer.pruneCollections(new Set(['posts']));
    expect(removed).toEqual(['pages']);
    await expect(fs.access(writer.collectionFile('pages'))).rejects.toThrow();
    await expect(fs.access(writer.collectionFile('posts'))).resolves.toBeUndefined();
  });
});
