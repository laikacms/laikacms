import { describe, expect, it } from 'vitest';

import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';

import { lexicalToPortableText } from '../bridge/lexicalToPortableText';
import { portableTextToLexical } from '../bridge/portableTextToLexical';
import { DEFAULT_EDITOR_SCHEMA, defineSchema } from '../schema/schema';

/** Serialize a PT doc to Lexical, then back to PT under `schema`, keys stripped. */
function throughSchema(
  doc: PortableTextDocument,
  schema: Parameters<typeof lexicalToPortableText>[1]['schema'],
): PortableTextDocument {
  return stripKeys(lexicalToPortableText(portableTextToLexical(doc), { schema }));
}

describe('DEFAULT_EDITOR_SCHEMA', () => {
  it('exposes the full decorator/style/list vocabulary', () => {
    expect(DEFAULT_EDITOR_SCHEMA.decorators?.map(d => d.name)).toContain('strong');
    expect(DEFAULT_EDITOR_SCHEMA.styles?.map(s => s.name)).toContain('blockquote');
    expect(DEFAULT_EDITOR_SCHEMA.blockObjects?.map(b => b.name)).toContain('table');
  });

  it('is the identity for serialization (no filtering)', () => {
    const doc: PortableTextDocument = [
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'q', marks: [] }] },
    ];
    expect(throughSchema(doc, DEFAULT_EDITOR_SCHEMA)).toEqual(stripKeys(doc));
  });
});

describe('schema enforcement on serialization', () => {
  const restrictive = defineSchema({
    decorators: [{ name: 'strong' }, { name: 'em' }],
    styles: [{ name: 'normal' }],
    lists: [{ name: 'bullet' }, { name: 'number' }],
    annotations: [],
    blockObjects: [],
    inlineObjects: [],
  });

  it('drops decorators not in the schema', () => {
    const doc: PortableTextDocument = [
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'keep', marks: ['strong'] },
          { _type: 'span', text: 'drop', marks: ['underline'] },
        ],
      },
    ];
    const out = throughSchema(doc, restrictive);
    const marks = (out[0] as { children: { marks: string[] }[] }).children.flatMap(c => c.marks);
    expect(marks).toContain('strong');
    expect(marks).not.toContain('underline');
  });

  it('demotes disallowed styles to normal', () => {
    const doc: PortableTextDocument = [
      { _type: 'block', style: 'blockquote', markDefs: [], children: [{ _type: 'span', text: 'q', marks: [] }] },
    ];
    const out = throughSchema(doc, restrictive);
    expect((out[0] as { style: string }).style).toBe('normal');
  });

  it('drops link annotations when the schema has no link', () => {
    const doc: PortableTextDocument = [
      {
        _type: 'block',
        style: 'normal',
        markDefs: [{ _type: 'link', _key: 'l1', href: 'https://example.com' }],
        children: [{ _type: 'span', text: 'site', marks: ['l1'] }],
      },
    ];
    const out = throughSchema(doc, restrictive) as { markDefs: unknown[], children: { marks: string[] }[] }[];
    expect(out[0].markDefs).toEqual([]);
    expect(out[0].children.flatMap(c => c.marks)).toEqual([]);
  });
});
