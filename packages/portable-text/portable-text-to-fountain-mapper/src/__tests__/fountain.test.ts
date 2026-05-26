import { type PortableTextDocument, stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { fountainFormat as format } from '../index';

function roundTrip(doc: PortableTextDocument): PortableTextDocument {
  return stripKeys(format.toPortableText(format.fromPortableText(doc)));
}
function expectStable(doc: PortableTextDocument): void {
  expect(roundTrip(doc)).toEqual(stripKeys(doc));
}

describe('fountain format', () => {
  it('parses an INT/EXT scene heading', () => {
    const pt = format.toPortableText('INT. KITCHEN - DAY\n');
    expect((pt[0] as { _type: string })._type).toBe('fountain:scene');
  });

  it('parses character + dialogue + parenthetical', () => {
    const pt = format.toPortableText(
      'INT. ROOM - NIGHT\n\nALICE\n(softly)\nHello, world.\n',
    );
    expect((pt[0] as { _type: string })._type).toBe('fountain:scene');
    expect((pt[1] as { _type: string })._type).toBe('fountain:character');
    expect((pt[2] as { _type: string })._type).toBe('fountain:parenthetical');
    expect((pt[3] as { _type: string })._type).toBe('fountain:dialogue');
  });

  it('parses a forced `@Name` character line', () => {
    const pt = format.toPortableText('@McAvoy\nDo it.\n');
    expect((pt[0] as { _type: string })._type).toBe('fountain:character');
    const ch = pt[0] as { children: { text: string }[] };
    expect(ch.children[0]?.text).toBe('McAvoy');
    expect((pt[1] as { _type: string })._type).toBe('fountain:dialogue');
  });

  it('parses an `ALL CAPS TO:` transition', () => {
    const pt = format.toPortableText('Action here.\n\nCUT TO:\n\nINT. NEW - DAY\n');
    expect((pt[1] as { _type: string })._type).toBe('fountain:transition');
  });

  it('parses inline `**bold**` / `*italic*` / `_underline_`', () => {
    const pt = format.toPortableText('She said *softly* and **loud** and _firm_.\n');
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'softly')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'loud')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'firm')?.marks).toEqual(['underline']);
  });

  it('parses `===` page breaks as hr', () => {
    const pt = format.toPortableText('Before\n\n===\n\nAfter');
    const types = pt.map(b => (b as { _type: string })._type);
    expect(types).toContain('hr');
  });

  it('parses `#`/`##` section headers', () => {
    const pt = format.toPortableText('# Act One\n\n## Scene 1\n');
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[1] as { style?: string }).style).toBe('h2');
  });

  it('round-trips a representative screenplay snippet', () => {
    expectStable([
      { _type: 'fountain:scene', children: [{ _type: 'span', text: 'INT. KITCHEN - DAY', marks: [] }] },
      { _type: 'fountain:character', children: [{ _type: 'span', text: 'ALICE', marks: [] }] },
      { _type: 'fountain:parenthetical', children: [{ _type: 'span', text: '(softly)', marks: [] }] },
      { _type: 'fountain:dialogue', children: [{ _type: 'span', text: 'Hello.', marks: [] }] },
      { _type: 'block', style: 'normal', markDefs: [], children: [{ _type: 'span', text: 'She smiles.', marks: [] }] },
    ]);
  });

  it('detects Fountain content', () => {
    expect(format.detect('INT. KITCHEN - DAY\n\nALICE\nHi.')).toBeGreaterThan(0.5);
    expect(format.detect('CUT TO:\n')).toBeGreaterThan(0.2);
    expect(format.detect('plain prose without screenplay markers')).toBe(0);
  });
});
