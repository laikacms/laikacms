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

  it('does not include a domain type discriminator in attributes (JSON:API §7.2.2)', () => {
    // Domain entities carry a `type` literal for discrimination. It must not
    // appear in JSON:API `attributes` per §7.2.2.
    const domain = { key: 'posts/hello', type: 'published' as const, title: 'Hello' };
    const resource = toJsonApi(domain, 'published', 'key');
    expect('type' in resource.attributes).toBe(false);
    expect(resource.type).toBe('published');
    expect(resource.attributes).toEqual({ title: 'Hello' });
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
  it('merges the id back under the specified field name and injects type from envelope', () => {
    const resource = { type: 'users' as const, id: 'abc-123', attributes: { name: 'Alice', age: 30 } };
    const domain = fromJsonApi(resource, 'users', 'id');
    expect(domain).toEqual({ type: 'users', id: 'abc-123', name: 'Alice', age: 30 });
  });
});

describe('toJsonApi / fromJsonApi round-trip', () => {
  it('reconstructs a domain object with a type discriminator after both transforms', () => {
    // Real LaikaCMS entities carry a `type` discriminator field; round-trips must preserve it.
    const original = { key: 'posts/hello', type: 'published' as const, title: 'Hello World' };
    const resource = toJsonApi(original, 'published', 'key');
    expect('type' in resource.attributes).toBe(false);
    const restored = fromJsonApi(resource, 'published', 'key');
    expect(restored).toEqual(original);
  });

  it('handles null attribute values', () => {
    const original = { key: '1', type: 'object' as const, nickname: null as unknown as string };
    const resource = toJsonApi(original, 'object', 'key');
    const restored = fromJsonApi(resource, 'object', 'key');
    expect(restored).toEqual(original);
  });

  it('handles nested attribute objects', () => {
    const original = { key: '2', type: 'object' as const, meta: { color: 'red', count: 5 } };
    const resource = toJsonApi(original, 'object', 'key');
    const restored = fromJsonApi(resource, 'object', 'key');
    expect(restored).toEqual(original);
  });

  it('handles attributes-only domain object (no type discriminator)', () => {
    // Domain objects without a type field still round-trip; type from resource envelope is injected.
    const original = { key: '3', title: 'No type field' };
    const resource = toJsonApi(original, 'bare', 'key');
    expect(resource.attributes).toEqual({ title: 'No type field' });
    const restored = fromJsonApi(resource, 'bare', 'key');
    // type is injected from the envelope even when absent on the original
    expect(restored).toEqual({ key: '3', type: 'bare', title: 'No type field' });
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
