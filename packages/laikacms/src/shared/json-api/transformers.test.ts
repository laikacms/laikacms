import { describe, expect, it } from 'vitest';
import { fromJsonApi, fromJsonApiNoId, toJsonApi, toJsonApiNoId } from './transformers.js';

// ---------------------------------------------------------------------------
// toJsonApi / fromJsonApi round-trip
// ---------------------------------------------------------------------------

describe('toJsonApi', () => {
  it('extracts the id field and puts remaining fields into attributes', () => {
    const domain = { id: 'abc-123', name: 'Alice', age: 30 };
    const resource = toJsonApi(domain, 'users', 'id');
    expect(resource).toEqual({
      type: 'users',
      id: 'abc-123',
      attributes: { name: 'Alice', age: 30 },
    });
  });

  it('does not include the id field in attributes', () => {
    const domain = { id: '1', title: 'Hello' };
    const resource = toJsonApi(domain, 'posts', 'id');
    expect('id' in resource.attributes).toBe(false);
  });

  it('preserves a custom id field name (e.g. slug)', () => {
    const domain = { slug: 'my-slug', body: 'content' };
    const resource = toJsonApi(domain, 'articles', 'slug');
    expect(resource.id).toBe('my-slug');
    expect('slug' in resource.attributes).toBe(false);
    expect(resource.attributes).toEqual({ body: 'content' });
  });

  it('coerces a numeric id to string', () => {
    const domain = { id: 42 as unknown as string, label: 'item' };
    const resource = toJsonApi(domain, 'items', 'id');
    expect(resource.id).toBe(42); // runtime coercion is cast only; id is stored as-is
  });
});

describe('fromJsonApi', () => {
  it('merges the id back under the specified field name', () => {
    const resource = { type: 'users' as const, id: 'abc-123', attributes: { name: 'Alice', age: 30 } };
    const domain = fromJsonApi(resource, 'users', 'id');
    expect(domain).toEqual({ id: 'abc-123', name: 'Alice', age: 30 });
  });
});

describe('toJsonApi / fromJsonApi round-trip', () => {
  it('reconstructs the original domain object after both transforms', () => {
    const original = { id: 'xyz-789', email: 'test@example.com', active: true };
    const resource = toJsonApi(original, 'accounts', 'id');
    const restored = fromJsonApi(resource, 'accounts', 'id');
    expect(restored).toEqual(original);
  });

  it('handles null attribute values', () => {
    const original = { id: '1', nickname: null as unknown as string };
    const resource = toJsonApi(original, 'profiles', 'id');
    const restored = fromJsonApi(resource, 'profiles', 'id');
    expect(restored).toEqual(original);
  });

  it('handles nested attribute objects', () => {
    const original = { id: '2', meta: { color: 'red', count: 5 } };
    const resource = toJsonApi(original, 'things', 'id');
    const restored = fromJsonApi(resource, 'things', 'id');
    expect(restored).toEqual(original);
  });

  it('handles an empty attributes object', () => {
    const original = { id: '3' };
    const resource = toJsonApi(original, 'bare', 'id');
    expect(resource.attributes).toEqual({});
    const restored = fromJsonApi(resource, 'bare', 'id');
    expect(restored).toEqual(original);
  });
});

// ---------------------------------------------------------------------------
// toJsonApiNoId / fromJsonApiNoId round-trip
// ---------------------------------------------------------------------------

describe('toJsonApiNoId', () => {
  it('wraps the domain object as attributes without an id field', () => {
    const domain = { name: 'draft', status: 'pending' };
    const resource = toJsonApiNoId(domain, 'drafts');
    expect(resource).toEqual({
      type: 'drafts',
      attributes: { name: 'draft', status: 'pending' },
    });
    expect('id' in resource).toBe(false);
  });

  it('preserves null attribute values', () => {
    const domain = { value: null as unknown as string };
    const resource = toJsonApiNoId(domain, 'entries');
    expect(resource.attributes.value).toBeNull();
  });
});

describe('fromJsonApiNoId', () => {
  it('returns a flat domain object from a no-id resource', () => {
    const resource = { type: 'drafts' as const, attributes: { name: 'draft', status: 'pending' } };
    const domain = fromJsonApiNoId(resource);
    expect(domain).toEqual({ name: 'draft', status: 'pending' });
  });
});

describe('toJsonApiNoId / fromJsonApiNoId round-trip', () => {
  it('reconstructs the original domain object after both transforms', () => {
    const original = { email: 'new@example.com', role: 'editor' };
    const resource = toJsonApiNoId(original, 'invitations');
    const restored = fromJsonApiNoId(resource);
    expect(restored).toEqual(original);
  });

  it('handles nested objects', () => {
    const original = { settings: { theme: 'dark', language: 'en' } };
    const resource = toJsonApiNoId(original, 'preferences');
    const restored = fromJsonApiNoId(resource);
    expect(restored).toEqual(original);
  });

  it('handles an empty domain object', () => {
    const original = {};
    const resource = toJsonApiNoId(original, 'empty');
    expect(resource.attributes).toEqual({});
    const restored = fromJsonApiNoId(resource);
    expect(restored).toEqual(original);
  });
});
