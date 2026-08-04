import { describe, expect, it } from 'vitest';
import { emitDeclarations, genericFallbackModule, wrapAmbientModule } from './compiler-emit.js';
import { renderItemModule } from './renderer.js';

describe('emitDeclarations', () => {
  it('lets the compiler type a string field as string and an array as T[]', async () => {
    const source = renderItemModule({
      namespace: 'doc',
      key: 'posts/a',
      content: { title: 'Hello', tags: ['a', 'b'] },
      meta: { key: 'a', language: 'en', status: 'published' },
    });
    const dts = await emitDeclarations(source);
    expect(dts).not.toBeNull();
    expect(dts!).toContain('title: string');
    expect(dts!).toContain('tags: string[]');
    expect(dts!).toContain('$key: string');
    // The compiler produced these — never hand-written.
    expect(dts!).toContain('export declare const title: string');
  });

  it('marks a field optional when it is missing on one branch of a union', async () => {
    const source = `const base = { title: "x" };
const __data = { ...base, ...(Math.random() ? { subtitle: "y" } : {}) };
export default __data;
`;
    const dts = await emitDeclarations(source);
    expect(dts).not.toBeNull();
    expect(dts!).toContain('subtitle?:');
  });

  it('returns null when typescript cannot be loaded (fallback path)', async () => {
    const dts = await emitDeclarations('export default 1;', async () => null);
    expect(dts).toBeNull();
  });

  it('wrapAmbientModule strips `declare` and wraps in an exact module block', () => {
    const wrapped = wrapAmbientModule(
      'laika:doc/posts/a',
      'export declare const title: string;\ndeclare const _default: { title: string };\nexport default _default;\n',
    );
    expect(wrapped).toContain("declare module 'laika:doc/posts/a' {");
    expect(wrapped).toContain('  export const title: string;');
    expect(wrapped).toContain('  const _default: { title: string };');
    expect(wrapped).not.toContain('export declare');
    expect(wrapped.trimEnd().endsWith('}')).toBe(true);
  });

  it('genericFallbackModule is the lowest-specificity wildcard', () => {
    const fallback = genericFallbackModule();
    expect(fallback).toContain("declare module 'laika:*'");
    expect(fallback).toContain('export default data');
  });
});
