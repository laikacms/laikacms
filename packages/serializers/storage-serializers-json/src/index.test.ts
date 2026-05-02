import type { JSONSchema7 } from 'json-schema';
import { describe, expect, it } from 'vitest';
import { jsonSerializer } from './index.js';

const schema: JSONSchema7 = { type: 'object' };

describe('jsonSerializer', () => {
  it('declares format = "json"', () => {
    expect(jsonSerializer.format).toBe('json');
  });

  it('roundtrips a simple object', async () => {
    const content = { title: 'Hello', count: 3, tags: ['a', 'b'] };
    const raw = await jsonSerializer.serializeDocumentFileContents(content, schema);
    const parsed = await jsonSerializer.deserializeDocumentFileContents(raw, schema);
    expect(parsed).toEqual(content);
  });

  it('produces pretty-printed JSON (2-space indent)', async () => {
    const out = await jsonSerializer.serializeDocumentFileContents({ a: 1 }, schema);
    expect(out).toBe('{\n  "a": 1\n}');
  });

  it('roundtrips nested objects and unicode', async () => {
    const content = {
      title: 'café ☕',
      nested: { deeper: { value: null, list: [1, 2, 3] } },
    };
    const raw = await jsonSerializer.serializeDocumentFileContents(content, schema);
    expect(await jsonSerializer.deserializeDocumentFileContents(raw, schema)).toEqual(content);
  });

  it('roundtrips an empty object', async () => {
    const raw = await jsonSerializer.serializeDocumentFileContents({}, schema);
    expect(await jsonSerializer.deserializeDocumentFileContents(raw, schema)).toEqual({});
  });

  it('rejects malformed JSON during deserialization', async () => {
    await expect(
      jsonSerializer.deserializeDocumentFileContents('{ not valid', schema),
    ).rejects.toThrow();
  });
});
