import type { JSONSchema7 } from 'json-schema';
import { describe, expect, it } from 'vitest';
import { yamlSerializer } from './index.js';

const schema: JSONSchema7 = { type: 'object' };

describe('yamlSerializer', () => {
  it('declares format = "yaml"', () => {
    expect(yamlSerializer.format).toBe('yaml');
  });

  it('roundtrips a flat object', async () => {
    const content = { title: 'Hello', count: 3, published: true };
    const raw = await yamlSerializer.serializeDocumentFileContents(content, schema);
    const parsed = await yamlSerializer.deserializeDocumentFileContents(raw, schema);
    expect(parsed).toEqual(content);
  });

  it('roundtrips nested structures and arrays', async () => {
    const content = {
      meta: { author: 'sem', tags: ['a', 'b', 'c'] },
      body: 'paragraph',
    };
    const raw = await yamlSerializer.serializeDocumentFileContents(content, schema);
    expect(await yamlSerializer.deserializeDocumentFileContents(raw, schema)).toEqual(content);
  });

  it('preserves date-like strings as strings (JSON_SCHEMA mode)', async () => {
    // Without JSON_SCHEMA, js-yaml would parse "2024-01-01" into a Date.
    const content = { date: '2024-01-01', isoLike: '12:00:00' };
    const raw = await yamlSerializer.serializeDocumentFileContents(content, schema);
    const parsed = await yamlSerializer.deserializeDocumentFileContents(raw, schema);
    expect(parsed).toEqual(content);
  });

  it('emits valid YAML output (no anchors/refs)', async () => {
    const shared = { name: 'sem' };
    const content = { a: shared, b: shared };
    const raw = await yamlSerializer.serializeDocumentFileContents(content, schema);
    // noRefs: true ensures no &anchor or *alias appears.
    expect(raw).not.toMatch(/[&*]\w+/);
  });

  it('deserializes a hand-written YAML document', async () => {
    const yaml = 'title: Hello\ncount: 7\ntags:\n  - one\n  - two\n';
    const parsed = await yamlSerializer.deserializeDocumentFileContents(yaml, schema);
    expect(parsed).toEqual({ title: 'Hello', count: 7, tags: ['one', 'two'] });
  });
});
