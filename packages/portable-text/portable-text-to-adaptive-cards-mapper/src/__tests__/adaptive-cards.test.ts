import { type PortableTextDocument } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { adaptiveCardsFormat as format } from '../index';

describe('adaptive-cards format', () => {
  it('parses a TextBlock with style:heading as a heading', () => {
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        { type: 'TextBlock', text: 'Title', style: 'heading', size: 'Large' },
        { type: 'TextBlock', text: 'Body' },
      ],
    });
    const pt = format.toPortableText(card);
    // [0] is the meta block.
    expect((pt[1] as { style?: string }).style).toBe('h2');
    expect((pt[2] as { style?: string }).style).toBe('normal');
  });

  it('maps heading sizes to h1..h5', () => {
    const sizes = ['ExtraLarge', 'Large', 'Medium', 'Default', 'Small'];
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: sizes.map(s => ({ type: 'TextBlock', text: s, style: 'heading', size: s })),
    });
    const pt = format.toPortableText(card);
    expect(pt.slice(1).map(b => (b as { style?: string }).style)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
  });

  it('parses RichTextBlock TextRun formatting flags into decorators', () => {
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'RichTextBlock',
          inlines: [
            { type: 'TextRun', text: 'plain ' },
            { type: 'TextRun', text: 'b', weight: 'Bolder' },
            { type: 'TextRun', text: ' ' },
            { type: 'TextRun', text: 'i', italic: true },
            { type: 'TextRun', text: ' ' },
            { type: 'TextRun', text: 'u', underline: true },
            { type: 'TextRun', text: ' ' },
            { type: 'TextRun', text: 's', strikethrough: true },
            { type: 'TextRun', text: ' ' },
            { type: 'TextRun', text: 'c', fontType: 'Monospace' },
          ],
        },
      ],
    });
    const pt = format.toPortableText(card);
    const spans = (pt[1] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 'u')?.marks).toEqual(['underline']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses TextRun.selectAction.url as a markDefs link', () => {
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [
        {
          type: 'RichTextBlock',
          inlines: [
            { type: 'TextRun', text: 'see ' },
            {
              type: 'TextRun',
              text: 'here',
              selectAction: { type: 'Action.OpenUrl', url: 'https://example.com' },
            },
          ],
        },
      ],
    });
    const pt = format.toPortableText(card);
    const block = pt[1] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses Image into a PT image block', () => {
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
      version: '1.5',
      body: [{ type: 'Image', url: 'https://example.com/x.png', altText: 'X' }],
    });
    const pt = format.toPortableText(card);
    expect((pt[1] as { _type: string })._type).toBe('image');
    expect((pt[1] as { url?: string }).url).toBe('https://example.com/x.png');
    expect((pt[1] as { alt?: string }).alt).toBe('X');
  });

  it('flattens Container.items in place', () => {
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [
        {
          type: 'Container',
          items: [
            { type: 'TextBlock', text: 'A' },
            { type: 'TextBlock', text: 'B' },
          ],
        },
      ],
    });
    const pt = format.toPortableText(card);
    expect(pt).toHaveLength(3); // meta + 2 blocks
    expect((pt[1] as { children: { text: string }[] }).children[0]?.text).toBe('A');
    expect((pt[2] as { children: { text: string }[] }).children[0]?.text).toBe('B');
  });

  it('preserves unknown elements as adaptive-card:raw blocks', () => {
    const card = JSON.stringify({
      type: 'AdaptiveCard',
      version: '1.5',
      body: [{ type: 'ActionSet', actions: [{ type: 'Action.OpenUrl', url: 'x' }] }],
    });
    const pt = format.toPortableText(card);
    expect((pt[1] as { _type: string })._type).toBe('adaptive-card:raw');
  });

  it('round-trips a representative card', () => {
    const original: PortableTextDocument = [
      {
        _type: 'adaptive-card:meta',
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.5',
      },
      { _type: 'block', style: 'h2', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
    ] as unknown as PortableTextDocument;
    const serialised = format.fromPortableText(original);
    const round = format.toPortableText(serialised);
    expect(round.find(b => (b as { style?: string }).style === 'h2')).toBeDefined();
    const para = round.find(b =>
      (b as { _type?: string })._type === 'block' && (b as { style?: string }).style === 'normal'
    ) as { children: { text: string, marks: string[] }[] } | undefined;
    expect(para?.children.find(c => c.marks.includes('strong'))?.text).toBe('bold');
  });

  it('detects Adaptive Cards content', () => {
    expect(
      format.detect(
        JSON.stringify({
          type: 'AdaptiveCard',
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          version: '1.5',
          body: [{ type: 'TextBlock', text: 'x' }],
        }),
      ),
    ).toBeGreaterThan(0.5);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
