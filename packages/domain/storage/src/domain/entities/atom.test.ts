import * as S from 'effect/Schema';
import { describe, expect, it } from 'vitest';
import { AtomSummarySchema } from './atom/atom-summary.js';
import { FolderSummarySchema } from './folder/folder-summary.js';
import { FolderSchema } from './folder/folder.js';
import { StorageObjectSummarySchema } from './object/storage-object-summary.js';
import { StorageObjectSchema } from './object/storage-object.js';

// StorageObjectSchema and FolderSchema are StandardSchemaV1 — use their ~standard.validate
// For decoding directly, re-import the inner Effect schemas via their constituent parts.

const decodeObject = S.decodeUnknownSync(
  S.Struct({
    key: S.String,
    createdAt: S.optional(S.String),
    updatedAt: S.optional(S.String),
    type: S.Literal('object'),
    content: S.Record(S.String, S.Any),
  }),
);

const decodeFolder = S.decodeUnknownSync(
  S.Struct({
    key: S.String,
    createdAt: S.optional(S.String),
    updatedAt: S.optional(S.String),
    type: S.Literal('folder'),
  }),
);

const decodeAtomSummary = S.decodeUnknownSync(AtomSummarySchema);

describe('StorageObject', () => {
  const validObject = {
    key: 'my/object',
    type: 'object' as const,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    content: { title: 'Hello', count: 42 },
  };

  it('accepts a valid storage object', () => {
    expect(() => decodeObject(validObject)).not.toThrow();
  });

  it('decodes correctly and preserves fields', () => {
    const result = decodeObject(validObject);
    expect(result.type).toBe('object');
    expect(result.key).toBe('my/object');
    expect(result.content).toEqual({ title: 'Hello', count: 42 });
  });

  it('accepts object without optional dates', () => {
    const obj = { key: 'file', type: 'object' as const, content: {} };
    expect(() => decodeObject(obj)).not.toThrow();
  });

  it('accepts object with empty content record', () => {
    const obj = { key: 'file', type: 'object' as const, content: {} };
    const result = decodeObject(obj);
    expect(result.content).toEqual({});
  });

  it('accepts object with nested content', () => {
    const obj = {
      key: 'docs/post',
      type: 'object' as const,
      content: { meta: { author: 'Alice', tags: ['a', 'b'] } },
    };
    expect(() => decodeObject(obj)).not.toThrow();
  });

  it('rejects when type is not "object"', () => {
    expect(() => decodeObject({ ...validObject, type: 'folder' })).toThrow();
  });

  it('rejects when key is missing', () => {
    const { key: _key, ...noKey } = validObject;
    expect(() => decodeObject(noKey)).toThrow();
  });

  it('validates via StandardSchema interface', async () => {
    const result = await (StorageObjectSchema as any)['~standard'].validate(validObject);
    expect(result.issues).toBeUndefined();
    expect(result.value).toBeDefined();
    expect(result.value.type).toBe('object');
  });

  it('reports issues for invalid data via StandardSchema', async () => {
    const result = await (StorageObjectSchema as any)['~standard'].validate({ type: 'wrong' });
    expect(result.issues).toBeDefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('Folder', () => {
  const validFolder = {
    key: 'my/folder',
    type: 'folder' as const,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
  };

  it('accepts a valid folder', () => {
    expect(() => decodeFolder(validFolder)).not.toThrow();
  });

  it('decodes correctly and preserves fields', () => {
    const result = decodeFolder(validFolder);
    expect(result.type).toBe('folder');
    expect(result.key).toBe('my/folder');
  });

  it('accepts folder without optional dates', () => {
    const folder = { key: 'dir', type: 'folder' as const };
    expect(() => decodeFolder(folder)).not.toThrow();
  });

  it('rejects when type is not "folder"', () => {
    expect(() => decodeFolder({ ...validFolder, type: 'object' })).toThrow();
  });

  it('rejects when key is missing', () => {
    const { key: _key, ...noKey } = validFolder;
    expect(() => decodeFolder(noKey)).toThrow();
  });

  it('validates via StandardSchema interface', async () => {
    const result = await (FolderSchema as any)['~standard'].validate(validFolder);
    expect(result.issues).toBeUndefined();
    expect(result.value).toBeDefined();
    expect(result.value.type).toBe('folder');
  });
});

describe('StorageObjectSummary', () => {
  it('accepts a valid object-summary', () => {
    expect(() => decodeAtomSummary({ type: 'object-summary', key: 'my/obj' })).not.toThrow();
  });

  it('decodes with optional dates', () => {
    const result = decodeAtomSummary({
      type: 'object-summary',
      key: 'my/obj',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.type).toBe('object-summary');
  });

  it('validates via StandardSchema interface', async () => {
    const result = await (StorageObjectSummarySchema as any)['~standard'].validate({
      type: 'object-summary',
      key: 'file',
    });
    expect(result.issues).toBeUndefined();
  });
});

describe('FolderSummary', () => {
  it('accepts a valid folder-summary', () => {
    expect(() => decodeAtomSummary({ type: 'folder-summary', key: 'my/folder' })).not.toThrow();
  });

  it('validates via StandardSchema interface', async () => {
    const result = await (FolderSummarySchema as any)['~standard'].validate({
      type: 'folder-summary',
      key: 'dir',
    });
    expect(result.issues).toBeUndefined();
  });
});

describe('AtomSummary union', () => {
  it('accepts object-summary variant', () => {
    expect(() => decodeAtomSummary({ type: 'object-summary', key: 'a' })).not.toThrow();
  });

  it('accepts folder-summary variant', () => {
    expect(() => decodeAtomSummary({ type: 'folder-summary', key: 'b' })).not.toThrow();
  });

  it('rejects unknown type', () => {
    expect(() => decodeAtomSummary({ type: 'unknown', key: 'c' })).toThrow();
  });

  it('rejects when key is missing', () => {
    expect(() => decodeAtomSummary({ type: 'object-summary' })).toThrow();
  });
});
