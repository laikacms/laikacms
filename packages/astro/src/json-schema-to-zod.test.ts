import { describe, expect, it } from 'vitest';

import { jsonSchemaToZod, type ZodNamespace, type ZodTypeLike } from './json-schema-to-zod.js';

/**
 * A minimal, dependency-free stand-in for the `z` namespace from `astro:content`.
 *
 * `json-schema-to-zod.ts` treats `z` as an opaque compatibility boundary (see its
 * own header comment), so exercising it against a real Zod install would test
 * Zod, not this module. Instead each factory here returns a schema that can
 * actually validate a value, which lets these tests assert real accept/reject
 * behaviour instead of just "the right method was called".
 */
interface FakeSchema extends ZodTypeLike {
  readonly kind: string;
  test(value: unknown): boolean;
  optional(): FakeSchema;
}

function schema(kind: string, test: (value: unknown) => boolean): FakeSchema {
  return {
    kind,
    test,
    optional(): FakeSchema {
      return schema(`${kind}?`, value => value === undefined || test(value));
    },
  };
}

const fakeZ: ZodNamespace = {
  string: () => schema('string', value => typeof value === 'string'),
  number: () => schema('number', value => typeof value === 'number'),
  boolean: () => schema('boolean', value => typeof value === 'boolean'),
  unknown: () => schema('unknown', () => true),
  array: (item: FakeSchema) => schema('array', value => Array.isArray(value) && value.every(entry => item.test(entry))),
  object: (shape: Record<string, FakeSchema>) =>
    schema('object', value => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      const knownKeys = new Set(Object.keys(shape));
      const hasOnlyKnownKeys = Object.keys(record).every(key => knownKeys.has(key));
      return hasOnlyKnownKeys && Object.entries(shape).every(([key, propSchema]) => propSchema.test(record[key]));
    }),
  looseObject: (shape: Record<string, FakeSchema>) =>
    schema('looseObject', value => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      return Object.entries(shape).every(([key, propSchema]) => propSchema.test(record[key]));
    }),
  enum: (values: readonly string[]) => schema('enum', value => typeof value === 'string' && values.includes(value)),
  union: (options: FakeSchema[]) => schema('union', value => options.some(option => option.test(value))),
  coerce: {
    date: () =>
      schema('date', value => {
        if (typeof value !== 'string') return false;
        return !Number.isNaN(new Date(value).getTime());
      }),
  },
};

/** Converts and casts the result back to the fake's richer shape for assertions. */
const convert = (input: Parameters<typeof jsonSchemaToZod>[0]) =>
  jsonSchemaToZod(input, fakeZ) as unknown as FakeSchema;

describe('jsonSchemaToZod', () => {
  it('converts each scalar type', () => {
    const source = convert({
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'integer' },
        ratio: { type: 'number' },
        draft: { type: 'boolean' },
      },
      required: ['title', 'count', 'ratio', 'draft'],
    });

    expect(source.test({ title: 'hello', count: 3, ratio: 1.5, draft: false })).toBe(true);
    expect(source.test({ title: 42, count: 3, ratio: 1.5, draft: false })).toBe(false);
    expect(source.test({ title: 'hello', count: 'three', ratio: 1.5, draft: false })).toBe(false);
    expect(source.test({ title: 'hello', count: 3, ratio: 1.5, draft: 'no' })).toBe(false);
  });

  it('converts an array of a homogeneous item type', () => {
    const source = convert({
      type: 'object',
      properties: { tags: { type: 'array', items: { type: 'string' } } },
      required: ['tags'],
    });

    expect(source.test({ tags: ['a', 'b'] })).toBe(true);
    expect(source.test({ tags: ['a', 1] })).toBe(false);
    expect(source.test({ tags: 'not-an-array' })).toBe(false);
  });

  it('converts a string enum', () => {
    const source = convert({
      type: 'object',
      properties: { status: { type: 'string', enum: ['draft', 'live'] } },
      required: ['status'],
    });

    expect(source.test({ status: 'draft' })).toBe(true);
    expect(source.test({ status: 'archived' })).toBe(false);
  });

  it('falls back to unknown for a mixed-type enum', () => {
    const source = convert({
      type: 'object',
      properties: { level: { enum: ['a', 1] } },
      required: ['level'],
    });

    // z.unknown() validates everything, including values no member would match.
    expect(source.test({ level: 'a' })).toBe(true);
    expect(source.test({ level: 1 })).toBe(true);
    expect(source.test({ level: {} })).toBe(true);
  });

  it('converts a variable-type list into a union', () => {
    const source = convert({
      type: 'object',
      properties: {
        block: {
          anyOf: [
            { type: 'object', properties: { kind: { type: 'string', enum: ['quote'] } }, required: ['kind'] },
            { type: 'object', properties: { kind: { type: 'string', enum: ['image'] } }, required: ['kind'] },
          ],
        },
      },
      required: ['block'],
    });

    expect(source.test({ block: { kind: 'quote' } })).toBe(true);
    expect(source.test({ block: { kind: 'image' } })).toBe(true);
    expect(source.test({ block: { kind: 'video' } })).toBe(false);
  });

  it('converts a single-member anyOf without wrapping it in a union', () => {
    const source = convert({
      type: 'object',
      properties: {
        block: { anyOf: [{ type: 'string' }] },
      },
      required: ['block'],
    });

    expect(source.test({ block: 'hello' })).toBe(true);
    expect(source.test({ block: 1 })).toBe(false);
  });

  it('converts an object with required and optional properties', () => {
    const source = convert({
      type: 'object',
      properties: { title: { type: 'string' }, draft: { type: 'boolean' } },
      required: ['title'],
    });

    expect(source.test({ title: 'hello' })).toBe(true);
    expect(source.test({ title: 'hello', draft: true })).toBe(true);
    expect(source.test({ draft: true })).toBe(false);
    // z.object() strips/rejects unknown keys — the opposite of looseObject.
    expect(source.test({ title: 'hello', extra: 'nope' })).toBe(false);
  });

  it('falls back to unknown() for an object schema with no declared properties', () => {
    const source = convert({ type: 'object' });

    expect(source.test({ anything: 'goes', nested: { ok: true } })).toBe(true);
  });

  it('falls back to unknown() for a missing schema entirely', () => {
    const source = convert(undefined as unknown as Parameters<typeof jsonSchemaToZod>[0]);

    expect(source.test({ whatever: 1 })).toBe(true);
  });

  it('looseObject preserves unknown keys that z.object() would reject/strip', () => {
    // json-schema-to-zod.ts never calls z.looseObject() itself — it always
    // declares an explicit `properties` shape — but the ZodNamespace contract
    // it exports promises this distinction for callers (documents-loader.ts,
    // objects-loader.ts) that build a permissive passthrough schema directly.
    // A `z.object({})` there would silently empty every entry's data.
    const declaredShape = { title: fakeZ.string() as FakeSchema };
    const strict = fakeZ.object(declaredShape) as FakeSchema;
    const loose = fakeZ.looseObject(declaredShape) as FakeSchema;

    const withExtraKey = { title: 'hello', extra: 'kept-or-not' };
    expect(strict.test(withExtraKey)).toBe(false);
    expect(loose.test(withExtraKey)).toBe(true);
  });

  it('coerces a date-formatted string', () => {
    const source = convert({
      type: 'object',
      properties: { on: { type: 'string', format: 'date' } },
      required: ['on'],
    });

    expect(source.test({ on: '2026-01-01' })).toBe(true);
    expect(source.test({ on: 'not-a-date' })).toBe(false);
  });

  it('coerces a date-time-formatted string', () => {
    const source = convert({
      type: 'object',
      properties: { at: { type: 'string', format: 'date-time' } },
      required: ['at'],
    });

    expect(source.test({ at: '2026-01-01T12:00:00Z' })).toBe(true);
    expect(source.test({ at: 'not-a-date' })).toBe(false);
  });

  it('leaves a plain string alone, without coercing to a date', () => {
    const source = convert({
      type: 'object',
      properties: { plain: { type: 'string' } },
      required: ['plain'],
    });

    expect(source.test({ plain: 'hello' })).toBe(true);
  });

  it('falls back to unknown() for a schema shape it cannot express', () => {
    const source = convert({
      type: 'object',
      properties: { weird: { type: 'null' } },
      required: ['weird'],
    });

    expect(source.test({ weird: null })).toBe(true);
    expect(source.test({ weird: 'anything at all' })).toBe(true);
  });

  it('falls back to unknown() for a boolean schema definition', () => {
    const source = convert({
      type: 'object',
      properties: { anything: false },
      required: ['anything'],
    });

    expect(source.test({ anything: 'literally anything' })).toBe(true);
  });
});
