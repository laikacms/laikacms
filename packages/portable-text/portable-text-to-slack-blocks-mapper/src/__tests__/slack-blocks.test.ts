import { type PortableTextDocument } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { slackBlocksFormat as format } from '../index';

describe('slack-blocks format', () => {
  it('parses a header block as h1', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [{ type: 'header', text: { type: 'plain_text', text: 'Title' } }],
      }),
    );
    expect((pt[0] as { style?: string }).style).toBe('h1');
    expect((pt[0] as { children: { text: string }[] }).children[0]?.text).toBe('Title');
  });

  it('parses a section block as a normal paragraph', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Body' } }],
      }),
    );
    expect((pt[0] as { style?: string }).style).toBe('normal');
  });

  it('parses rich_text TextRun style flags into decorators', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [
          {
            type: 'rich_text',
            elements: [
              {
                type: 'rich_text_section',
                elements: [
                  { type: 'text', text: 'plain ' },
                  { type: 'text', text: 'b', style: { bold: true } },
                  { type: 'text', text: ' ' },
                  { type: 'text', text: 'i', style: { italic: true } },
                  { type: 'text', text: ' ' },
                  { type: 'text', text: 's', style: { strike: true } },
                  { type: 'text', text: ' ' },
                  { type: 'text', text: 'c', style: { code: true } },
                ],
              },
            ],
          },
        ],
      }),
    );
    const spans = (pt[0] as { children: { text: string, marks: string[] }[] }).children;
    expect(spans.find(s => s.text === 'b')?.marks).toEqual(['strong']);
    expect(spans.find(s => s.text === 'i')?.marks).toEqual(['em']);
    expect(spans.find(s => s.text === 's')?.marks).toEqual(['strike-through']);
    expect(spans.find(s => s.text === 'c')?.marks).toEqual(['code']);
  });

  it('parses link elements as markDefs links', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [
          {
            type: 'rich_text',
            elements: [
              {
                type: 'rich_text_section',
                elements: [
                  { type: 'text', text: 'see ' },
                  { type: 'link', url: 'https://example.com', text: 'here' },
                ],
              },
            ],
          },
        ],
      }),
    );
    const block = pt[0] as { markDefs: { href: string }[], children: { text: string, marks: string[] }[] };
    expect(block.markDefs[0]?.href).toBe('https://example.com');
    expect(block.children.find(c => c.text === 'here')?.marks).toHaveLength(1);
  });

  it('parses rich_text_list (bullet/ordered) into list blocks with indent → level', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [
          {
            type: 'rich_text',
            elements: [
              {
                type: 'rich_text_list',
                style: 'bullet',
                indent: 0,
                elements: [
                  { type: 'rich_text_section', elements: [{ type: 'text', text: 'a' }] },
                  { type: 'rich_text_section', elements: [{ type: 'text', text: 'b' }] },
                ],
              },
              {
                type: 'rich_text_list',
                style: 'ordered',
                indent: 1,
                elements: [
                  { type: 'rich_text_section', elements: [{ type: 'text', text: 'x' }] },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect((pt[0] as { listItem?: string, level?: number }).listItem).toBe('bullet');
    expect((pt[1] as { level?: number }).level).toBe(1);
    expect((pt[2] as { listItem?: string, level?: number }).listItem).toBe('number');
    expect((pt[2] as { level?: number }).level).toBe(2);
  });

  it('parses rich_text_preformatted as a code block and rich_text_quote as blockquote', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [
          {
            type: 'rich_text',
            elements: [
              {
                type: 'rich_text_preformatted',
                elements: [{ type: 'text', text: 'x = 1\ny = 2' }],
              },
              {
                type: 'rich_text_quote',
                elements: [{ type: 'text', text: 'said' }],
              },
            ],
          },
        ],
      }),
    );
    expect((pt[0] as { _type: string })._type).toBe('code');
    expect((pt[0] as { code?: string }).code).toBe('x = 1\ny = 2');
    expect((pt[1] as { style?: string }).style).toBe('blockquote');
  });

  it('parses divider as hr and image as PT image', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [
          { type: 'divider' },
          { type: 'image', image_url: 'https://example.com/x.png', alt_text: 'X' },
        ],
      }),
    );
    expect((pt[0] as { _type: string })._type).toBe('hr');
    expect((pt[1] as { _type: string })._type).toBe('image');
    expect((pt[1] as { url?: string }).url).toBe('https://example.com/x.png');
  });

  it('preserves unknown block types as slack-block:raw', () => {
    const pt = format.toPortableText(
      JSON.stringify({
        blocks: [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Go' } }] }],
      }),
    );
    expect((pt[0] as { _type: string })._type).toBe('slack-block:raw');
  });

  it('accepts a bare-array payload', () => {
    const pt = format.toPortableText(
      JSON.stringify([{ type: 'section', text: { type: 'plain_text', text: 'hi' } }]),
    );
    expect(pt).toHaveLength(1);
    expect((pt[0] as { style?: string }).style).toBe('normal');
  });

  it('round-trips a representative block document', () => {
    const original: PortableTextDocument = [
      { _type: 'block', style: 'h1', markDefs: [], children: [{ _type: 'span', text: 'Title', marks: [] }] },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        children: [
          { _type: 'span', text: 'plain ', marks: [] },
          { _type: 'span', text: 'bold', marks: ['strong'] },
        ],
      },
      {
        _type: 'block',
        style: 'normal',
        markDefs: [],
        listItem: 'bullet',
        level: 1,
        children: [{ _type: 'span', text: 'one', marks: [] }],
      },
    ];
    const serialised = format.fromPortableText(original);
    const round = format.toPortableText(serialised);
    expect(round.find(b => (b as { style?: string }).style === 'h1')).toBeDefined();
    const paragraph = round.find(b => {
      const x = b as { style?: string, listItem?: string };
      return x.style === 'normal' && !x.listItem;
    });
    expect(paragraph).toBeDefined();
    const listBlock = round.find(b => (b as { listItem?: string }).listItem === 'bullet');
    expect(listBlock).toBeDefined();
  });

  it('detects Slack Block Kit JSON', () => {
    expect(
      format.detect(
        JSON.stringify({
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: 'x' } },
            { type: 'divider' },
          ],
        }),
      ),
    ).toBeGreaterThan(0.4);
    expect(format.detect('plain prose')).toBe(0);
    expect(format.detect('{"foo":"bar"}')).toBe(0);
  });
});
