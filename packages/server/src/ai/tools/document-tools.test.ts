import { describe, expect, it } from 'vitest';

// The validators are not exported from document-tools.ts, so we exercise them
// indirectly through the jsonSchema `validate` hook embedded in each tool's
// inputSchema.  The Vercel AI SDK exposes that hook via
// `tool.inputSchema.validate(value)`.
import { getDocumentData, updateDocument } from './document-tools.ts';

// The AI SDK's jsonSchema wrapper stores the validate callback on the schema
// object returned by jsonSchema().  Access it via the tool's inputSchema.
type ValidateResult =
  | { success: true, value: unknown }
  | { success: false, error: Error };

function callValidate(tool: { inputSchema: { validate?: (v: unknown) => ValidateResult } }, value: unknown) {
  const validate = tool.inputSchema.validate;
  if (!validate) throw new Error('no validate hook');
  return validate(value);
}

// ---------------------------------------------------------------------------
// validateEmptyObject  (used by getDocumentData)
// ---------------------------------------------------------------------------
describe('validateEmptyObject (via getDocumentData.inputSchema.validate)', () => {
  it('accepts an empty object', () => {
    const result = callValidate(getDocumentData, {});
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual({});
  });

  it('rejects an object with keys', () => {
    const result = callValidate(getDocumentData, { foo: 1 });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeInstanceOf(Error);
  });

  it('rejects an array', () => {
    const result = callValidate(getDocumentData, []);
    expect(result.success).toBe(false);
  });

  it('rejects null', () => {
    const result = callValidate(getDocumentData, null);
    expect(result.success).toBe(false);
  });

  it('rejects a string', () => {
    const result = callValidate(getDocumentData, 'string');
    expect(result.success).toBe(false);
  });

  it('rejects a number', () => {
    const result = callValidate(getDocumentData, 42);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateUpdateDocumentInput  (used by updateDocument)
// ---------------------------------------------------------------------------
describe('validateUpdateDocumentInput (via updateDocument.inputSchema.validate)', () => {
  // --- success paths -------------------------------------------------------
  it('accepts a minimal add operation', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'add', path: '/title', value: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts all six op types with valid fields', () => {
    const ops = [
      { op: 'add', path: '/a', value: 1 },
      { op: 'remove', path: '/b' },
      { op: 'replace', path: '/c', value: 2 },
      { op: 'move', path: '/d', from: '/e' },
      { op: 'copy', path: '/f', from: '/g' },
      { op: 'test', path: '/h', value: 3 },
    ];
    const result = callValidate(updateDocument, { operations: ops });
    expect(result.success).toBe(true);
  });

  it('accepts an empty operations array', () => {
    const result = callValidate(updateDocument, { operations: [] });
    expect(result.success).toBe(true);
  });

  // --- failure paths -------------------------------------------------------
  it('rejects when operations key is absent', () => {
    const result = callValidate(updateDocument, {});
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeInstanceOf(Error);
  });

  it('rejects when operations is not an array', () => {
    const result = callValidate(updateDocument, { operations: 'not-array' });
    expect(result.success).toBe(false);
  });

  it('rejects a top-level extra key', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'remove', path: '/x' }],
      extra: true,
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation with an unknown op', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'patch', path: '/x' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation with a missing op', () => {
    const result = callValidate(updateDocument, {
      operations: [{ path: '/x', value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation with a missing path', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'add', value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation with a non-string path', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'add', path: 42, value: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation with a non-string from', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'move', path: '/b', from: 123 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an operation with an unknown key', () => {
    const result = callValidate(updateDocument, {
      operations: [{ op: 'add', path: '/x', value: 1, unknown: true }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects when one operation in the array is invalid', () => {
    const result = callValidate(updateDocument, {
      operations: [
        { op: 'add', path: '/x', value: 1 },
        { op: 'BAD', path: '/y' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-object input', () => {
    const result = callValidate(updateDocument, null);
    expect(result.success).toBe(false);
  });

  it('rejects an array input', () => {
    const result = callValidate(updateDocument, []);
    expect(result.success).toBe(false);
  });
});
