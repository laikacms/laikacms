import { stripKeys } from '@laikacloud/portabletext-core';
import { describe, expect, it } from 'vitest';

import { markdownFormat as format } from '../index';

const SAMPLE = [
  '# Title',
  '',
  'A paragraph with **bold** and *italic* text and a [link](https://example.com).',
  '',
  '- one',
  '- two',
  '',
  '> a quote',
].join('\n');

describe('markdown format', () => {
  it('round-trips structure through Markdown -> PT -> Markdown -> PT', () => {
    const pt1 = format.toPortableText(SAMPLE);
    const pt2 = format.toPortableText(format.fromPortableText(pt1));
    expect(stripKeys(pt2)).toEqual(stripKeys(pt1));
  });

  it('produces text blocks from a heading and paragraph', () => {
    const pt = format.toPortableText('# Hello\n\nWorld');
    expect(pt).toHaveLength(2);
    expect((pt[0] as { style?: string }).style).toBe('h1');
  });

  it('scores Markdown syntax above plain prose', () => {
    expect(format.detect('# Heading\n\n- item')).toBeGreaterThan(0.5);
    expect(format.detect('just some words')).toBeGreaterThan(0);
    expect(format.detect('')).toBe(0);
  });
});
