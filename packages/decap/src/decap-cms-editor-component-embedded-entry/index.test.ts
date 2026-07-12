import { describe, expect, it } from 'vitest';

import { DecapCmsEditorComponentEmbeddedEntry } from './index.js';

const { fromBlock, toBlock, toPreview, pattern } = DecapCmsEditorComponentEmbeddedEntry;

// ---------------------------------------------------------------------------
// pattern
// ---------------------------------------------------------------------------

describe('pattern', () => {
  it('matches a well-formed shortcode', () => {
    const src = '{{< embedded-entry "posts" "my-post" >}}';
    expect(pattern.test(src)).toBe(true);
  });

  it('captures collection as group 1 and entry as group 2', () => {
    const match = '{{< embedded-entry "posts" "my-post" >}}'.match(pattern);
    expect(match?.[1]).toBe('posts');
    expect(match?.[2]).toBe('my-post');
  });

  it('does not match a shortcode with a missing entry argument', () => {
    expect(pattern.test('{{< embedded-entry "posts" >}}')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fromBlock
// ---------------------------------------------------------------------------

describe('fromBlock', () => {
  it('returns collection and entry from a regex match', () => {
    const match = '{{< embedded-entry "posts" "hello-world" >}}'.match(pattern);
    expect(fromBlock(match!)).toEqual({ collection: 'posts', entry: 'hello-world' });
  });
  // Note: the real CmsEditorComponentOptions.fromBlock signature is (match: RegExpMatchArray)
  // — callers never pass null; the Decap engine only calls fromBlock when the pattern matches.
});

// ---------------------------------------------------------------------------
// toBlock
// ---------------------------------------------------------------------------

describe('toBlock', () => {
  it('produces the correct shortcode string', () => {
    expect(toBlock({ collection: 'posts', entry: 'my-post' })).toBe(
      '{{< embedded-entry "posts" "my-post" >}}',
    );
  });

  it('roundtrips through fromBlock → toBlock', () => {
    const original = '{{< embedded-entry "articles" "intro-article" >}}';
    const match = original.match(pattern);
    const data = fromBlock(match!);
    expect(toBlock(data as Parameters<typeof toBlock>[0])).toBe(original);
  });
});

// ---------------------------------------------------------------------------
// toPreview
// ---------------------------------------------------------------------------

describe('toPreview', () => {
  it('throws when data is not EmbeddedEntryData', () => {
    expect(() => toPreview({ notCollection: 'x' })).toThrow('Invalid data for Embedded Entry component');
  });

  it('throws when data is null', () => {
    expect(() => toPreview(null)).toThrow('Invalid data for Embedded Entry component');
  });

  it('returns a React element with the correct type', () => {
    const el = toPreview({ collection: 'posts', entry: 'hello' });
    // The element should be an object (React element, not a thrown error)
    expect(el).toBeTruthy();
    expect(typeof el).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// fields
// ---------------------------------------------------------------------------

describe('fields', () => {
  it('has two fields: collection and entry, both string widgets', () => {
    const { fields } = DecapCmsEditorComponentEmbeddedEntry;
    expect(fields).toHaveLength(2);
    expect(fields?.[0]).toMatchObject({ name: 'collection', widget: 'string' });
    expect(fields?.[1]).toMatchObject({ name: 'entry', widget: 'string' });
  });
});
