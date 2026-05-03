import type { JSONSchema7 } from 'json-schema';
import { describe, expect, it } from 'vitest';
import { markdownSerializer } from './index.js';

const schema: JSONSchema7 = { type: 'object' };

describe('markdownSerializer', () => {
  it('emits frontmatter + body', async () => {
    const raw = await markdownSerializer.serializeDocumentFileContents(
      { title: 'Hello', body: '# Heading\n\nparagraph' },
      schema,
    );
    expect(raw).toMatch(/^---\n/);
    expect(raw).toContain('title: Hello');
    expect(raw).toContain('# Heading');
  });

  it('roundtrips frontmatter and body', async () => {
    const original = {
      title: 'Hello',
      tags: ['a', 'b'],
      published: true,
      body: '# Heading\n\nparagraph\n',
    };
    const raw = await markdownSerializer.serializeDocumentFileContents(original, schema);
    const parsed = await markdownSerializer.deserializeDocumentFileContents(raw, schema);
    expect(parsed.title).toBe('Hello');
    expect(parsed.tags).toEqual(['a', 'b']);
    expect(parsed.published).toBe(true);
    // gray-matter normalizes a trailing newline; assert the heading round-tripped.
    expect((parsed.body as string).trim()).toBe('# Heading\n\nparagraph');
  });

  it('handles content with no frontmatter', async () => {
    const parsed = await markdownSerializer.deserializeDocumentFileContents(
      'just some text\nwith two lines\n',
      schema,
    );
    expect(parsed.body).toBe('just some text\nwith two lines\n');
  });

  it('does not duplicate the body field inside frontmatter', async () => {
    const raw = await markdownSerializer.serializeDocumentFileContents(
      { title: 't', body: 'BODY' },
      schema,
    );
    // The body should appear exactly once, after the closing `---`.
    const beforeBody = raw.split('BODY')[0];
    expect(beforeBody).not.toMatch(/^body:/m);
  });

  it('uses an empty body when input has no body field', async () => {
    const raw = await markdownSerializer.serializeDocumentFileContents(
      { title: 'only meta' },
      schema,
    );
    const parsed = await markdownSerializer.deserializeDocumentFileContents(raw, schema);
    expect(parsed.title).toBe('only meta');
    expect((parsed.body as string).trim()).toBe('');
  });
});
