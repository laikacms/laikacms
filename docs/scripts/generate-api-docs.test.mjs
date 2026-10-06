import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { entryPointsFromExports, entryPointsFromPackages } from './generate-api-docs.mjs';

let packageDir;

beforeEach(() => {
  packageDir = mkdtempSync(join(tmpdir(), 'generate-api-docs-'));
});

afterEach(() => {
  rmSync(packageDir, { recursive: true, force: true });
});

function writeExports(exports) {
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'laikacms', exports }));
}

describe('entryPointsFromExports', () => {
  it('maps each export to its source file, named by import specifier', () => {
    writeExports({
      '.': { types: './dist/index.d.ts', import: './dist/index.js' },
      './core': { types: './dist/shared/core/index.d.ts', import: './dist/shared/core/index.js' },
    });

    expect([...entryPointsFromExports(packageDir)]).toEqual([
      [join(packageDir, 'src/index.ts'), 'laikacms'],
      [join(packageDir, 'src/shared/core/index.ts'), 'laikacms/core'],
    ]);
  });

  it('keeps the first-listed specifier when subpaths alias the same file', () => {
    writeExports({
      './storage/fs': { types: './dist/impl/storage-fs/index.d.ts' },
      './storage-fs': { types: './dist/impl/storage-fs/index.d.ts' },
    });

    expect([...entryPointsFromExports(packageDir).values()]).toEqual(['laikacms/storage/fs']);
  });

  it('skips wildcard and non-type exports', () => {
    writeExports({
      './*': { types: './dist/*.d.ts' },
      './package.json': './package.json',
      './styles.css': { default: './dist/styles.css' },
    });

    expect(entryPointsFromExports(packageDir).size).toBe(0);
  });
});

describe('entryPointsFromPackages', () => {
  function writePackage(dir, manifest) {
    mkdirSync(join(packageDir, dir), { recursive: true });
    writeFileSync(join(packageDir, dir, 'package.json'), JSON.stringify(manifest));
  }

  it('collects every published package, named by its own package name', () => {
    writePackage('laikacms', { name: 'laikacms', exports: { './core': { types: './dist/core/index.d.ts' } } });
    writePackage('github', {
      name: '@laikacms/github',
      exports: { './storage-gh': { types: './dist/storage-gh/index.d.ts' } },
    });

    expect([...entryPointsFromPackages(packageDir)]).toEqual([
      [join(packageDir, 'github/src/storage-gh/index.ts'), '@laikacms/github/storage-gh'],
      [join(packageDir, 'laikacms/src/core/index.ts'), 'laikacms/core'],
    ]);
  });

  it('skips private packages and directories without a package.json', () => {
    writePackage('internal', {
      name: '@laikacms/internal',
      private: true,
      exports: { '.': { types: './dist/index.d.ts' } },
    });
    mkdirSync(join(packageDir, 'scratch'));

    expect(entryPointsFromPackages(packageDir).size).toBe(0);
  });
});
