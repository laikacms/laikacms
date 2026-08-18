import { describe, expect, it } from 'vitest';
import { BODY_EXPORT } from './bodies.js';
import { renderModule } from './module.js';

describe('renderModule', () => {
  it('emits a named export for a safe-identifier content key', () => {
    const source = renderModule({ content: { title: 'Hello' } });
    expect(source).toContain('export const title = __f0;');
    expect(source).not.toContain('as "title"');
  });

  it('emits an arbitrary module namespace export for an unsafe content key', () => {
    const source = renderModule({ content: { 'kebab-case': 'value' } });
    expect(source).toContain('export { __f0 as "kebab-case" };');
    expect(source).not.toContain('export const kebab-case');
  });

  it('emits a $-prefixed export per meta key', () => {
    const source = renderModule({ content: {}, meta: { key: 'posts/hello', lang: 'en' } });
    expect(source).toContain('export const $key = "posts/hello";');
    expect(source).toContain('export const $lang = "en";');
  });

  it('skips meta entries whose value is undefined', () => {
    const source = renderModule({ content: {}, meta: { key: 'posts/hello', status: undefined } });
    expect(source).toContain('export const $key = "posts/hello";');
    expect(source).not.toContain('$status');
  });

  it('throws a collision error when mdxSpecifier is set and content already has a BODY_EXPORT field', () => {
    expect(() =>
      renderModule({
        content: { [BODY_EXPORT]: 'oops' },
        meta: { key: 'posts/hello' },
        mdxSpecifier: '/bodies/posts/hello.mdx',
      })
    ).toThrow(/posts\/hello/);
    expect(() =>
      renderModule({
        content: { [BODY_EXPORT]: 'oops' },
        mdxSpecifier: '/bodies/posts/hello.mdx',
      })
    ).toThrow(new RegExp(`"${BODY_EXPORT}" field`));
  });

  it('appends a Body re-export from the mdx specifier when there is no collision', () => {
    const source = renderModule({
      content: { title: 'Hello' },
      mdxSpecifier: '/bodies/posts/hello.mdx',
    });
    expect(source).toContain(
      `export { default as ${BODY_EXPORT} } from "/bodies/posts/hello.mdx";`,
    );
  });

  it('does not append a Body re-export when mdxSpecifier is not set', () => {
    const source = renderModule({ content: { title: 'Hello' } });
    expect(source).not.toContain(`as ${BODY_EXPORT} } from`);
  });

  it('aggregates all content entries under their original keys in the default export', () => {
    const source = renderModule({ content: { title: 'Hello', 'kebab-case': 'value' } });
    expect(source).toContain('export default { "title": __f0, "kebab-case": __f1 };');
  });
});
