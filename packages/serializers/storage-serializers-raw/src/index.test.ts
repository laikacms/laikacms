import type { JSONSchema7 } from 'json-schema';
import { describe, expect, it } from 'vitest';
import { rawSerializer } from './index.js';

const schema: JSONSchema7 = { type: 'object' };

describe('rawSerializer', () => {
  it('serializes the body string verbatim', async () => {
    const out = await rawSerializer.serializeDocumentFileContents(
      { body: '# Heading\n\nbody text' },
      schema,
    );
    expect(out).toBe('# Heading\n\nbody text');
  });

  it('produces an empty string when body is missing', async () => {
    expect(await rawSerializer.serializeDocumentFileContents({}, schema)).toBe('');
  });

  it('coerces non-string body values to a string', async () => {
    const out = await rawSerializer.serializeDocumentFileContents({ body: 42 }, schema);
    expect(out).toBe('42');
  });

  it('deserializes raw text into { body }', async () => {
    const parsed = await rawSerializer.deserializeDocumentFileContents('hello world', schema);
    expect(parsed).toEqual({ body: 'hello world' });
  });

  it('roundtrips body content', async () => {
    const original = { body: 'multi\nline\ncontent' };
    const raw = await rawSerializer.serializeDocumentFileContents(original, schema);
    const parsed = await rawSerializer.deserializeDocumentFileContents(raw, schema);
    expect(parsed).toEqual(original);
  });

  it('drops non-body fields on serialization', async () => {
    const out = await rawSerializer.serializeDocumentFileContents(
      { body: 'kept', title: 'dropped' },
      schema,
    );
    expect(out).toBe('kept');
  });
});
