import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { writeAtomic } from './atomic-write.js';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'laika-atomic-write-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('writeAtomic', () => {
  it('returns false and does not write when content matches the existing file', async () => {
    const file = path.join(tmpDir, 'unchanged.txt');
    await fs.writeFile(file, 'same content', 'utf8');
    const before = (await fs.stat(file)).mtimeMs;

    const changed = await writeAtomic(file, 'same content');

    expect(changed).toBe(false);
    expect(await fs.readFile(file, 'utf8')).toBe('same content');
    expect((await fs.stat(file)).mtimeMs).toBe(before);
  });

  it('returns true and creates the file when it is missing', async () => {
    const file = path.join(tmpDir, 'nested', 'new-file.txt');

    const changed = await writeAtomic(file, 'hello world');

    expect(changed).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('hello world');
  });

  it('returns true and overwrites when content differs from the existing file', async () => {
    const file = path.join(tmpDir, 'existing.txt');
    await fs.writeFile(file, 'old content', 'utf8');

    const changed = await writeAtomic(file, 'new content');

    expect(changed).toBe(true);
    expect(await fs.readFile(file, 'utf8')).toBe('new content');
  });

  it('leaves no leftover temp files after a write', async () => {
    const file = path.join(tmpDir, 'clean.txt');

    await writeAtomic(file, 'content');

    const entries = await fs.readdir(tmpDir);
    expect(entries).toEqual(['clean.txt']);
  });
});
