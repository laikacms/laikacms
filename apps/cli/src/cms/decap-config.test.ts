import { describe, expect, it } from 'vitest';

import { serialize } from './decap-config.js';

describe('serialize', () => {
  it('includes export default config', () => {
    const output = serialize({}, { sourcePath: 'config.yml' });
    expect(output).toContain('export default config');
  });

  it('emits the @generated header comment', () => {
    const output = serialize({}, { sourcePath: 'config.yml' });
    expect(output).toContain('// @generated');
  });

  it('embeds the source path from options in the header', () => {
    const output = serialize({}, { sourcePath: 'src/config.yml' });
    expect(output).toContain('src/config.yml');
  });

  it('round-trips a minimal config object as JSON', () => {
    const config = { backend: { name: 'git-gateway' }, collections: [] };
    const output = serialize(config, { sourcePath: 'config.yml' });
    // The serialized JSON body must contain the backend name
    expect(output).toContain('"git-gateway"');
  });

  it('assigns the literal to a const named config', () => {
    const output = serialize({ foo: 1 }, { sourcePath: 'x.yml' });
    expect(output).toMatch(/const config\s*=/);
  });

  it('emits as const so typeof config works for helper types', () => {
    const output = serialize({ x: 'y' }, { sourcePath: 'x.yml' });
    expect(output).toContain('as const');
  });

  it('emits per-collection Entry types for named collections', () => {
    const config = {
      collections: [
        { name: 'posts', fields: [{ name: 'title', widget: 'string' }] },
      ],
    };
    const output = serialize(config, { sourcePath: 'config.yml' });
    expect(output).toContain('PostsEntry');
    expect(output).toContain('type Entry =');
  });

  it('handles hyphenated collection names with PascalCase', () => {
    const config = {
      collections: [
        { name: 'blog-posts', fields: [] },
      ],
    };
    const output = serialize(config, { sourcePath: 'config.yml' });
    expect(output).toContain('BlogPostsEntry');
  });

  it('skips collection type emission when collections array is absent', () => {
    const output = serialize({ backend: { name: 'test' } }, { sourcePath: 'c.yml' });
    // No Entry type should be emitted when there are no collections
    expect(output).not.toContain('type Entry =');
  });

  it('includes eslint-disable pragma so linters skip the generated file', () => {
    const output = serialize({}, { sourcePath: 'c.yml' });
    expect(output).toContain('/* eslint-disable */');
  });

  it('produces valid TypeScript that starts with // @generated', () => {
    const output = serialize({}, { sourcePath: 'c.yml' });
    expect(output.trimStart()).toMatch(/^\/\/ @generated/);
  });
});
