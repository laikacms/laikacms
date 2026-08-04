import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { chunkPath, chunkSpecifier, pruneChunks, writeChunk } from './bodies.js';

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-bodies-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('chunk locations', () => {
  it('resolves the specifier and the path to the same file', () => {
    // Two independent derivations of one location: if they ever drift, every
    // generated module imports a file that is not there.
    const id = { namespace: 'store', key: 'pillars/01-mit' } as const;
    expect(path.join(root, chunkSpecifier(id))).toBe(chunkPath(root, id));
  });

  it('keeps a chunk inside the bodies directory whatever the key contains', () => {
    // Keys come from the repository, which is not necessarily a filesystem.
    const escaped = chunkPath(root, { namespace: 'store', key: '../../etc/pass wd' });
    expect(escaped.startsWith(path.join(root, '.laika', 'bodies'))).toBe(true);
    expect(escaped).not.toContain('..');
  });
});

describe('writeChunk', () => {
  it('writes the body once and reports the no-op on an identical rewrite', async () => {
    // Chunks live inside the Vite root, so a redundant write would bounce back
    // through the watcher as a spurious hot update.
    const id = { namespace: 'store', key: 'platform' } as const;
    expect(await writeChunk(root, id, 'Hosted **gateway**.')).toBe(true);
    expect(await writeChunk(root, id, 'Hosted **gateway**.')).toBe(false);
    expect(await fs.readFile(chunkPath(root, id), 'utf8')).toBe('Hosted **gateway**.\n');
    expect(await writeChunk(root, id, 'Rewritten.')).toBe(true);
  });
});

describe('pruneChunks', () => {
  it('removes the chunks this build did not write, and only those', async () => {
    const live = { namespace: 'store', key: 'pillars/01-mit' } as const;
    const types = path.join(root, '.laika', 'types.d.ts');
    await writeChunk(root, live, 'still here');
    await writeChunk(root, { namespace: 'store', key: 'pillars/00-renamed-away' }, 'gone');
    await fs.mkdir(path.dirname(types), { recursive: true });
    await fs.writeFile(types, '// generated types\n', 'utf8');

    const removed = await pruneChunks(root, new Set([chunkPath(root, live)]));

    expect(removed).toEqual([chunkPath(root, { namespace: 'store', key: 'pillars/00-renamed-away' })]);
    expect(await fs.readFile(chunkPath(root, live), 'utf8')).toBe('still here\n');
    expect(await fs.readFile(types, 'utf8')).toContain('generated types');
  });

  it('is a no-op before anything has been written', async () => {
    expect(await pruneChunks(root, new Set())).toEqual([]);
  });
});
