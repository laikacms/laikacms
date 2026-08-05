import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { aggregatePackageDocs } from './aggregate-package-docs.mjs';

let root;
let packagesDir;
let docsRoot;

function write(path, content) {
  const fullPath = join(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content);
}

function readDirSnapshot(dir) {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(e => e.isFile())
    .map(e => join((e.parentPath ?? e.path).replace(dir, ''), e.name).split(sep).join('/'))
    .sort()
    .map(relPath => [relPath, readFileSync(join(dir, relPath), 'utf8')]);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'lcms-454-'));
  packagesDir = join(root, 'packages');
  docsRoot = join(root, 'docs');
  mkdirSync(join(docsRoot, '.vitepress'), { recursive: true });

  write(
    'packages/pkg-a/docs/index.md',
    '---\ntitle: Package A\norder: 2\n---\n\n# Package A\n\nSee the [usage guide](./usage.md).\n',
  );
  write(
    'packages/pkg-a/docs/usage.md',
    '---\ntitle: Usage\norder: 1\n---\n\n# Usage\n\nBack to [overview](./index.md).\n',
  );
  write(
    'packages/pkg-b/docs/index.md',
    '---\ntitle: Package B\norder: 1\n---\n\n# Package B\n',
  );
  write('packages/no-docs-pkg/src/index.ts', 'export {};\n');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('aggregatePackageDocs', () => {
  it('aggregates package docs into the VitePress source tree', () => {
    const result = aggregatePackageDocs({ packagesDir, docsRoot });

    expect(result.packageCount).toBe(2);
    expect(result.pageCount).toBe(3);
    expect(readFileSync(join(docsRoot, 'reference/packages/pkg-a/index.md'), 'utf8')).toContain('Package A');
    expect(readFileSync(join(docsRoot, 'reference/packages/pkg-a/usage.md'), 'utf8')).toContain('Usage');
    expect(readFileSync(join(docsRoot, 'reference/packages/pkg-b/index.md'), 'utf8')).toContain('Package B');
  });

  it('generates a sidebar ordered by package/page order', () => {
    aggregatePackageDocs({ packagesDir, docsRoot });
    const sidebar = JSON.parse(readFileSync(join(docsRoot, '.vitepress/generated/package-sidebar.json'), 'utf8'));

    expect(sidebar.map(pkg => pkg.text)).toEqual(['Package B', 'Package A']);
    expect(sidebar[1].link).toBe('/reference/packages/pkg-a/');
    expect(sidebar[1].items.map(p => p.text)).toEqual(['Usage']);
    expect(sidebar[1].items[0].link).toBe('/reference/packages/pkg-a/usage');
  });

  it('is idempotent — a second run against unchanged input yields byte-identical output', () => {
    aggregatePackageDocs({ packagesDir, docsRoot });
    const first = readDirSnapshot(docsRoot);

    aggregatePackageDocs({ packagesDir, docsRoot });
    const second = readDirSnapshot(docsRoot);

    expect(second).toEqual(first);
  });

  it('does not leave stale generated pages when a package doc is removed', () => {
    aggregatePackageDocs({ packagesDir, docsRoot });
    rmSync(join(packagesDir, 'pkg-a/docs/usage.md'));
    write('packages/pkg-a/docs/index.md', '---\ntitle: Package A\norder: 2\n---\n\n# Package A\n');

    aggregatePackageDocs({ packagesDir, docsRoot });

    expect(readdirSync(join(docsRoot, 'reference/packages/pkg-a'))).toEqual(['index.md']);
  });

  it('fails loudly on a missing required title', () => {
    write('packages/pkg-c/docs/index.md', '# No frontmatter title\n');

    expect(() => aggregatePackageDocs({ packagesDir, docsRoot })).toThrow(/missing required frontmatter "title"/);
  });

  it('fails loudly on a broken relative link', () => {
    write('packages/pkg-d/docs/index.md', '---\ntitle: Package D\n---\n\nSee [missing](./missing.md).\n');

    expect(() => aggregatePackageDocs({ packagesDir, docsRoot })).toThrow(/does not resolve to a file/);
  });
});
