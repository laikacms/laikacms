import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { bibtexFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('bibtex format', () => {
  it('parses a basic @article entry', () => {
    const pt = format.toPortableText(
      `@article{doe2024,\n  author = {Doe, John},\n  title = {The Title},\n  journal = {J},\n  year = {2024}\n}`,
    );
    expect((pt[0] as { _type: string })._type).toBe('bibtex:entry');
    const entry = pt[0] as { entryType: string, citationKey: string, fields: Record<string, string> };
    expect(entry.entryType).toBe('article');
    expect(entry.citationKey).toBe('doe2024');
    expect(entry.fields.author).toBe('Doe, John');
    expect(entry.fields.title).toBe('The Title');
    expect(entry.fields.year).toBe('2024');
  });

  it('handles quoted field values', () => {
    const pt = format.toPortableText(
      `@book{k,\n  author = "Smith, Jane",\n  title = "A Book"\n}`,
    );
    const entry = pt[0] as { fields: Record<string, string> };
    expect(entry.fields.author).toBe('Smith, Jane');
    expect(entry.fields.title).toBe('A Book');
  });

  it('preserves nested braces in a field value', () => {
    const pt = format.toPortableText(
      `@misc{k,\n  title = {The {LaTeX} book}\n}`,
    );
    const entry = pt[0] as { fields: Record<string, string> };
    expect(entry.fields.title).toBe('The {LaTeX} book');
  });

  it('parses @string macro definitions', () => {
    const pt = format.toPortableText(`@string{acm = "Association for Computing Machinery"}`);
    expect((pt[0] as { _type: string })._type).toBe('bibtex:string');
    const s = pt[0] as { name: string, value: string };
    expect(s.name).toBe('acm');
    expect(s.value).toBe('Association for Computing Machinery');
  });

  it('parses @preamble blocks', () => {
    const pt = format.toPortableText(`@preamble{"\\\\newcommand{\\\\foo}{bar}"}`);
    expect((pt[0] as { _type: string })._type).toBe('bibtex:preamble');
  });

  it('drops @comment blocks and `%` line comments', () => {
    const pt = format.toPortableText(
      `% a line comment\n@comment{ignored}\n@misc{k, title = {OK}}`,
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { _type: string })._type).toBe('bibtex:entry');
  });

  it('parses multiple entries in sequence', () => {
    const pt = format.toPortableText(
      `@article{a, title = {A}}\n\n@book{b, title = {B}}`,
    );
    expect(pt).toHaveLength(2);
    expect((pt[0] as { citationKey: string }).citationKey).toBe('a');
    expect((pt[1] as { citationKey: string }).citationKey).toBe('b');
  });

  it('round-trips a multi-entry library', () => {
    expectStable([
      {
        _type: 'bibtex:entry',
        entryType: 'article',
        citationKey: 'doe2024',
        fields: { author: 'Doe, John', title: 'A Paper', year: '2024' },
      },
      {
        _type: 'bibtex:string',
        name: 'acm',
        value: 'Association for Computing Machinery',
      },
      {
        _type: 'bibtex:entry',
        entryType: 'book',
        citationKey: 'smith2023',
        fields: { author: 'Smith, Jane', title: 'A Book' },
      },
    ] as unknown as PortableTextDocument);
  });

  it('detects BibTeX content', () => {
    expect(format.detect('@article{k, title = {x}}')).toBeGreaterThan(0.2);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
