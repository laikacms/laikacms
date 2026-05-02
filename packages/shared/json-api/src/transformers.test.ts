import { describe, expect, it } from 'vitest';
import { fromJsonApi, fromJsonApiNoId, toJsonApi, toJsonApiNoId } from './transformers.js';

describe('toJsonApi', () => {
  it('extracts the id field and folds the rest into attributes', () => {
    const out = toJsonApi(
      { id: '42', title: 'Hello', count: 3 },
      'documents',
      'id',
    );
    expect(out).toEqual({
      type: 'documents',
      id: '42',
      attributes: { title: 'Hello', count: 3 },
    });
  });

  it('honors a non-default id field name', () => {
    const out = toJsonApi(
      { docKey: 'k1', body: 'text' },
      'documents',
      'docKey',
    );
    expect(out).toEqual({
      type: 'documents',
      id: 'k1',
      attributes: { body: 'text' },
    });
  });

  it('does not mutate the input object', () => {
    const input = { id: '1', value: 'v' };
    toJsonApi(input, 'thing', 'id');
    expect(input).toEqual({ id: '1', value: 'v' });
  });
});

describe('toJsonApiNoId', () => {
  it('wraps the data as attributes under a type', () => {
    const out = toJsonApiNoId({ name: 'sem' }, 'users');
    expect(out).toEqual({ type: 'users', attributes: { name: 'sem' } });
  });

  it('handles an empty object', () => {
    expect(toJsonApiNoId({}, 'empty')).toEqual({ type: 'empty', attributes: {} });
  });
});

describe('fromJsonApi', () => {
  it('inverts toJsonApi (roundtrip)', () => {
    const original = { id: '7', title: 'roundtrip', tags: ['a', 'b'] };
    const wire = toJsonApi(original, 'documents', 'id');
    const back = fromJsonApi(wire, 'documents', 'id');
    expect(back).toEqual(original);
  });

  it('uses the configured id field name on the way back', () => {
    const wire = { type: 'documents', id: 'k1', attributes: { body: 'text' } };
    const back = fromJsonApi(wire, 'documents', 'docKey');
    expect(back).toEqual({ docKey: 'k1', body: 'text' });
  });
});

describe('fromJsonApiNoId', () => {
  it('inverts toJsonApiNoId', () => {
    const original = { name: 'sem', age: 30 };
    const wire = toJsonApiNoId(original, 'users');
    expect(fromJsonApiNoId(wire)).toEqual(original);
  });

  it('returns a fresh object (not the original attributes reference)', () => {
    const attrs = { value: 1 };
    const out = fromJsonApiNoId({ type: 'x', attributes: attrs });
    expect(out).toEqual(attrs);
    expect(out).not.toBe(attrs);
  });
});
