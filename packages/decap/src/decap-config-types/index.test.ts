import { describe, expectTypeOf, it } from 'vitest';

import type { ExtractCollectionType, ExtractFieldsType, ExtractFieldType } from './index.js';

// ---------------------------------------------------------------------------
// ExtractFieldType — scalar widgets
// ---------------------------------------------------------------------------

describe('ExtractFieldType — scalar widgets', () => {
  it('infers string for widget: string', () => {
    type F = { widget: 'string' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string>();
  });

  it('infers number for widget: number', () => {
    type F = { widget: 'number' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<number>();
  });

  it('infers boolean for widget: boolean', () => {
    type F = { widget: 'boolean' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<boolean>();
  });

  it('infers unknown for an unrecognised widget', () => {
    type F = { widget: 'custom-unknown-widget' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<unknown>();
  });
});

// ---------------------------------------------------------------------------
// ExtractFieldType — select widget (scalar and multiple)
// ---------------------------------------------------------------------------

describe('ExtractFieldType — select widget', () => {
  it('infers literal union from string options (no multiple)', () => {
    type F = { widget: 'select', options: readonly ['draft', 'published'] };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<'draft' | 'published'>();
  });

  it('infers value union from object options (no multiple)', () => {
    type F = { widget: 'select', options: readonly [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<'a' | 'b'>();
  });

  it('infers Array<union> for select with multiple: true and string options', () => {
    type F = { widget: 'select', options: readonly ['draft', 'published'], multiple: true };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<Array<'draft' | 'published'>>();
  });

  it('infers Array<value-union> for select with multiple: true and object options', () => {
    type F = { widget: 'select', options: readonly [{ value: 'x' }, { value: 'y' }], multiple: true };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<Array<'x' | 'y'>>();
  });
});

// ---------------------------------------------------------------------------
// ExtractFieldType — image, file, relation with multiple: true
// ---------------------------------------------------------------------------

describe('ExtractFieldType — multiple on image, file, relation', () => {
  it('infers string[] for image with multiple: true', () => {
    type F = { widget: 'image', multiple: true };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string[]>();
  });

  it('infers string for image without multiple (scalar)', () => {
    type F = { widget: 'image' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string>();
  });

  it('infers string[] for file with multiple: true', () => {
    type F = { widget: 'file', multiple: true };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string[]>();
  });

  it('infers string for file without multiple (scalar)', () => {
    type F = { widget: 'file' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string>();
  });

  it('infers string[] for relation with multiple: true', () => {
    type F = { widget: 'relation', multiple: true };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string[]>();
  });

  it('infers string for relation without multiple (scalar)', () => {
    type F = { widget: 'relation' };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<string>();
  });
});

// ---------------------------------------------------------------------------
// ExtractFieldType — list widget
// ---------------------------------------------------------------------------

describe('ExtractFieldType — list widget', () => {
  it('infers array of structured items when list has fields', () => {
    type F = { widget: 'list', fields: readonly [{ name: 'title', widget: 'string' }] };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<{ title: string }[]>();
  });

  it('infers array of scalar type when list has a single field template', () => {
    type F = { widget: 'list', field: { widget: 'number' } };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<number[]>();
  });
});

// ---------------------------------------------------------------------------
// ExtractFieldType — object widget
// ---------------------------------------------------------------------------

describe('ExtractFieldType — object widget', () => {
  it('infers structured record when object has fields', () => {
    type F = { widget: 'object', fields: readonly [{ name: 'x', widget: 'number' }] };
    expectTypeOf<ExtractFieldType<F>>().toEqualTypeOf<{ x: number }>();
  });
});

// ---------------------------------------------------------------------------
// ExtractFieldsType — required vs optional
// ---------------------------------------------------------------------------

describe('ExtractFieldsType — required vs optional', () => {
  it('required field is not optional (required: true by default)', () => {
    type Fields = readonly [{ name: 'title', widget: 'string' }];
    type Result = ExtractFieldsType<Fields>;
    expectTypeOf<Result>().toMatchTypeOf<{ title: string }>();
  });

  it('field with required: false becomes optional', () => {
    type Fields = readonly [
      { name: 'title', widget: 'string' },
      { name: 'summary', widget: 'string', required: false },
    ];
    type Result = ExtractFieldsType<Fields>;
    expectTypeOf<Result>().toMatchTypeOf<{ title: string, summary?: string }>();
  });
});

// ---------------------------------------------------------------------------
// ExtractCollectionType
// ---------------------------------------------------------------------------

describe('ExtractCollectionType', () => {
  it('derives entry type from a collection with fields', () => {
    type Collection = {
      name: 'posts',
      fields: readonly [
        { name: 'title', widget: 'string' },
        { name: 'tags', widget: 'select', options: readonly ['a', 'b'], multiple: true },
      ],
    };
    type Result = ExtractCollectionType<Collection>;
    expectTypeOf<Result>().toMatchTypeOf<{ title: string, tags: Array<'a' | 'b'> }>();
  });
});
