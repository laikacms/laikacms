import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readAdapters, readmeToSection } from './generate-adapter-docs.mjs';

let rootDir;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'generate-adapter-docs-'));
  mkdirSync(join(rootDir, 'storage-x'));
  writeFileSync(join(rootDir, 'storage-x', 'README.md'), '# x\n');
  writeFileSync(join(rootDir, 'storage-x', 'icon.svg'), '<svg/>');
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

const writeAdapters = yaml => writeFileSync(join(rootDir, 'adapters.yaml'), yaml);
const adapter = key => `- { key: ${key}, name: X, icon: storage-x/icon.svg, storage: storage-x }\n`;

describe('readAdapters', () => {
  it('reads a valid list', () => {
    writeAdapters(adapter('x'));
    expect(readAdapters(rootDir)).toEqual([{ key: 'x', name: 'X', icon: 'storage-x/icon.svg', storage: 'storage-x' }]);
  });

  it('rejects duplicate keys', () => {
    writeAdapters(adapter('x') + adapter('x'));
    expect(() => readAdapters(rootDir)).toThrow(/duplicate key/);
  });

  it('rejects an iconDark that does not exist', () => {
    writeAdapters(
      '- { key: x, name: X, icon: storage-x/icon.svg, iconDark: storage-x/dark.svg, storage: storage-x }\n',
    );
    expect(() => readAdapters(rootDir)).toThrow(/iconDark storage-x\/dark\.svg does not exist/);
  });

  it('rejects a repository folder without a README', () => {
    mkdirSync(join(rootDir, 'assets-x'));
    writeAdapters('- { key: x, name: X, icon: storage-x/icon.svg, assets: assets-x }\n');
    expect(() => readAdapters(rootDir)).toThrow(/has no README\.md/);
  });
});

describe('readmeToSection', () => {
  it('drops the title, nests headings and leaves code fences alone', () => {
    const md = '# Title\n\nIntro\n\n## Usage\n\n```md\n# not a heading\n## nor this\n```\n';
    expect(readmeToSection(md, 'pkg')).toBe('Intro\n\n### Usage\n\n```md\n# not a heading\n## nor this\n```');
  });

  it('rewrites relative links to docs pages and to GitHub', () => {
    const md = '[api](../../docs/reference/json-api/storage.md#x) [src](./testing.ts) [web](https://a.b)';
    expect(readmeToSection(md, 'packages/pkg')).toBe(
      '[api](/reference/json-api/storage#x) '
        + '[src](https://github.com/laikacms/laikacms/blob/develop/packages/pkg/testing.ts) [web](https://a.b)',
    );
  });
});
