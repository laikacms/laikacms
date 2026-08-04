import { describe, expect, it } from 'vitest';
import { emitDeclarations } from './compiler-emit.js';
import { renderItemModule } from './renderer.js';

describe('renderItemModule', () => {
  it('renders doc named exports, $-meta exports and default (widening form)', () => {
    const out = renderItemModule({
      namespace: 'doc',
      key: 'posts/a',
      content: { title: 'Hello', tags: ['a'], 'not-ident': 1 },
      meta: { key: 'a', language: 'en', status: 'published' },
    });

    // Widening form: no `as const`.
    expect(out).not.toContain('as const');
    // Non-identifier content key stays in the data object but is not a named export.
    expect(out).toContain('"not-ident": 1');
    expect(out).toContain('export const { title, tags, $key, $language, $status } = __data;');
    expect(out).not.toMatch(/export const \{[^}]*not-ident/);
    expect(out.trimEnd().endsWith('export default __data;')).toBe(true);
  });

  it('omits $version when absent and includes it when present', () => {
    const without = renderItemModule({
      namespace: 'doc',
      key: 'posts/a',
      content: {},
      meta: { key: 'a', language: 'en', status: 'published' },
    });
    expect(without).not.toContain('$version');

    const withVersion = renderItemModule({
      namespace: 'doc',
      key: 'posts/a',
      content: {},
      meta: { key: 'a', language: 'en', status: 'published', version: '3' },
    });
    expect(withVersion).toContain('$version');
    expect(withVersion).toContain('export const { $key, $language, $status, $version } = __data;');
  });

  it('renders store $key, $type and spread metadata keys', () => {
    const out = renderItemModule({
      namespace: 'store',
      key: 'images/logo',
      content: { url: '/logo.png' },
      meta: { key: 'images/logo', type: 'object', metadata: { width: 100, alt: 'Logo' } },
    });
    expect(out).toContain('export const { url, $key, $type, $width, $alt } = __data;');
    expect(out).toContain('"$width": 100');
    expect(out).toContain('"$alt": "Logo"');
  });

  it('appends `as const` in literals mode', () => {
    const out = renderItemModule({
      namespace: 'doc',
      key: 'posts/a',
      content: { title: 'Hello' },
      meta: { key: 'a', language: 'en', status: 'published' },
    }, { literals: true });
    expect(out).toContain('} as const;');
  });

  it('declares the compiled body only for items that have prose', async () => {
    // The declaration has to survive tsc's emit with `mdx/types` unresolved
    // here — it resolves in the consuming project, via @types/mdx.
    const withProse = await emitDeclarations(renderItemModule({
      namespace: 'store',
      key: 'platform',
      content: { badge: 'Soon', body: 'Prose.' },
      meta: { key: 'platform' },
    }, { mdx: true }));
    expect(withProse).toContain('Body: import("mdx/types").MDXContent');
    expect(withProse).toMatch(/body:\s*string/);

    const withoutProse = await emitDeclarations(renderItemModule({
      namespace: 'store',
      key: 'nav',
      content: { label: 'Docs' },
      meta: { key: 'nav' },
    }, { mdx: true }));
    expect(withoutProse).not.toContain('Body');
  });

  it('produces a valid module with no named exports when empty', () => {
    const out = renderItemModule({
      namespace: 'doc',
      key: 'x/y',
      content: {},
      meta: {},
    });
    expect(out).toContain('const __data = {}');
    expect(out).not.toContain('export const {');
    expect(out).toContain('export default __data;');
  });
});
