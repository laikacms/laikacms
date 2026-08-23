import { describe, expect, it, vi } from 'vitest';

import { digestOf, entryIdOf, keyOf, splitContent, toDataEntry } from './mapping.js';

const digest = (data: Record<string, unknown> | string) => typeof data === 'string' ? data : JSON.stringify(data);

const context = (overrides: Partial<Parameters<typeof toDataEntry>[1]> = {}) => ({
  collection: 'posts',
  entry: {},
  render: {},
  renderMarkdown: async (content: string) => ({ html: `<p>${content}</p>` }),
  generateDigest: digest,
  parseData: async <TData extends Record<string, unknown>>(props: { data: TData }) => props.data,
  ...overrides,
});

describe('entryIdOf', () => {
  it('strips the collection prefix', () => {
    expect(entryIdOf('posts/hello', 'posts', {})).toBe('hello');
  });

  it('keeps nested slashes so the id survives a folder hierarchy', () => {
    expect(entryIdOf('posts/2026/08/hello', 'posts', {})).toBe('2026/08/hello');
  });

  it('leaves a key that does not carry the prefix alone', () => {
    expect(entryIdOf('elsewhere/hello', 'posts', {})).toBe('elsewhere/hello');
  });

  it('round-trips through keyOf', () => {
    const key = 'posts/2026/hello';
    expect(keyOf(entryIdOf(key, 'posts', {}), 'posts')).toBe(key);
  });

  it('honours a custom derivation', () => {
    const id = entryIdOf('posts/hello', 'posts', { id: ({ key }) => key.replace('/', '--') });
    expect(id).toBe('posts--hello');
  });
});

describe('splitContent', () => {
  it('separates the body field from the rest of the content', () => {
    const result = splitContent(
      { key: 'posts/a', content: { title: 'Hi', body: '# Hi' } },
      { entry: {}, render: {} },
    );
    expect(result.data).toEqual({ title: 'Hi' });
    expect(result.body).toBe('# Hi');
  });

  it('reports no body when the field is absent — a YAML or JSON record', () => {
    const result = splitContent(
      { key: 'config/site', content: { name: 'Laika' } },
      { entry: {}, render: {} },
    );
    expect(result.data).toEqual({ name: 'Laika' });
    expect(result.body).toBeUndefined();
  });

  it('ignores a non-string body rather than passing it to a markdown renderer', () => {
    const result = splitContent(
      { key: 'posts/a', content: { body: { nested: true } } },
      { entry: {}, render: {} },
    );
    expect(result.body).toBeUndefined();
  });

  it('honours a custom body field', () => {
    const result = splitContent(
      { key: 'posts/a', content: { title: 'Hi', markdown: '# Hi' } },
      { entry: {}, render: { bodyField: 'markdown' } },
    );
    expect(result.data).toEqual({ title: 'Hi' });
    expect(result.body).toBe('# Hi');
  });

  it('copies the key and version into data only when asked', () => {
    const record = { key: 'posts/a', content: { title: 'Hi' }, version: 'v1' };
    expect(splitContent(record, { entry: {}, render: {} }).data).toEqual({ title: 'Hi' });
    expect(
      splitContent(record, { entry: { keyField: '_key', versionField: '_version' }, render: {} }).data,
    ).toEqual({ title: 'Hi', _key: 'posts/a', _version: 'v1' });
  });
});

describe('digestOf', () => {
  it('prefers the repository version token over hashing', () => {
    expect(digestOf({ key: 'a', content: { title: 'x' }, version: 'v7' }, digest)).toBe('v7');
  });

  it('falls back to hashing the content when there is no version', () => {
    const a = digestOf({ key: 'a', content: { title: 'x' } }, digest);
    const b = digestOf({ key: 'a', content: { title: 'x' } }, digest);
    const c = digestOf({ key: 'a', content: { title: 'y' } }, digest);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('toDataEntry', () => {
  it('renders markdown eagerly by default and retains the raw body', async () => {
    const entry = await toDataEntry(
      { key: 'posts/hello', content: { title: 'Hi', body: '# Hi' } },
      context(),
    );
    expect(entry.id).toBe('hello');
    expect(entry.data).toEqual({ title: 'Hi' });
    expect(entry.body).toBe('# Hi');
    expect(entry.rendered).toEqual({ html: '<p># Hi</p>' });
    expect(entry.deferredRender).toBeUndefined();
  });

  it('does not render when there is no body', async () => {
    const entry = await toDataEntry({ key: 'posts/hello', content: { title: 'Hi' } }, context());
    expect(entry.rendered).toBeUndefined();
  });

  it('skips rendering under mode "none" but still exposes the body', async () => {
    const entry = await toDataEntry(
      { key: 'posts/hello', content: { body: '# Hi' } },
      context({ render: { mode: 'none' } }),
    );
    expect(entry.rendered).toBeUndefined();
    expect(entry.body).toBe('# Hi');
  });

  it('drops the body when retainBody is false', async () => {
    const entry = await toDataEntry(
      { key: 'posts/hello', content: { body: '# Hi' } },
      context({ render: { retainBody: false } }),
    );
    expect(entry.body).toBeUndefined();
    expect(entry.rendered).toEqual({ html: '<p># Hi</p>' });
  });

  it('passes the resolved id to parseData, so schema errors name the right entry', async () => {
    const parseData = vi.fn(async (props: { data: Record<string, unknown> }) => props.data);
    await toDataEntry(
      { key: 'posts/2026/hello', content: { title: 'Hi' } },
      context({ parseData: parseData as never }),
    );
    expect(parseData).toHaveBeenCalledWith({ id: '2026/hello', data: { title: 'Hi' } });
  });

  describe('deferred rendering', () => {
    it('defers and registers the module import when a file path resolves', async () => {
      const addModuleImport = vi.fn();
      const entry = await toDataEntry(
        { key: 'posts/hello', content: { body: '# Hi' } },
        context({
          render: { mode: 'deferred', filePath: () => '/abs/content/posts/hello.md' },
          addModuleImport,
        }),
      );
      expect(entry.deferredRender).toBe(true);
      expect(entry.filePath).toBe('/abs/content/posts/hello.md');
      expect(entry.rendered).toBeUndefined();
      expect(addModuleImport).toHaveBeenCalledWith('/abs/content/posts/hello.md');
    });

    it('falls back to eager markdown when no file path resolves, and says so', async () => {
      const onDeferredUnavailable = vi.fn();
      const entry = await toDataEntry(
        { key: 'posts/hello', content: { body: '# Hi' } },
        context({ render: { mode: 'deferred', filePath: () => undefined }, onDeferredUnavailable }),
      );
      expect(entry.deferredRender).toBeUndefined();
      expect(entry.rendered).toEqual({ html: '<p># Hi</p>' });
      expect(onDeferredUnavailable).toHaveBeenCalledOnce();
    });
  });

  describe('asset imports', () => {
    it('are recorded when a file path anchors the relative image paths', async () => {
      const entry = await toDataEntry(
        { key: 'posts/hello', content: { body: '![](./a.png)' } },
        context({
          render: { filePath: () => '/abs/content/posts/hello.md' },
          renderMarkdown: async () => ({ html: '<p/>', metadata: { imagePaths: ['./a.png'] } }),
        }),
      );
      expect(entry.filePath).toBe('/abs/content/posts/hello.md');
      expect(entry.assetImports).toEqual(['./a.png']);
    });

    it('are dropped when there is no file path to resolve them against', async () => {
      const entry = await toDataEntry(
        { key: 'posts/hello', content: { body: '![](./a.png)' } },
        context({
          renderMarkdown: async () => ({ html: '<p/>', metadata: { imagePaths: ['./a.png'] } }),
        }),
      );
      expect(entry.assetImports).toBeUndefined();
    });
  });
});
