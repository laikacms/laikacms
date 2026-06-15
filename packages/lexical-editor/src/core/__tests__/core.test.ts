import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  detectMapper as detectFormat,
  type Mapper as Format,
  registerMapper as registerFormat,
  unregisterMapper as unregisterFormat,
} from '@laikacloud/portabletext-core';

import { LexicalRichtextValue as RichtextValue } from '../value/LexicalRichtextValue';

/** Minimal in-memory format whose Portable Text payload is one text block. */
function fakeFormat(id: string, detect: (value: string) => number): Format {
  return {
    id,
    detect,
    toPortableText: value => [
      { _type: 'block', style: 'normal', children: [{ _type: 'span', text: value, marks: [] }] },
    ],
    fromPortableText: () => `<<${id}>>`,
  };
}

afterEach(() => {
  ['alpha', 'beta', 'spied'].forEach(unregisterFormat);
});

describe('detectFormat', () => {
  it('picks the highest-scoring format', () => {
    registerFormat(fakeFormat('alpha', () => 0.9));
    registerFormat(fakeFormat('beta', () => 0.2));
    expect(detectFormat('x')).toBe('alpha');
  });

  it('uses the hint to break a tie between close scores', () => {
    registerFormat(fakeFormat('alpha', () => 0.8));
    registerFormat(fakeFormat('beta', () => 0.78));
    expect(detectFormat('x', 'beta')).toBe('beta');
    expect(detectFormat('x', 'alpha')).toBe('alpha');
  });

  it('ignores the hint when one format clearly wins', () => {
    registerFormat(fakeFormat('alpha', () => 0.9));
    registerFormat(fakeFormat('beta', () => 0.1));
    expect(detectFormat('x', 'beta')).toBe('alpha');
  });
});

describe('RichtextValue laziness', () => {
  it('does not serialize on construction or on editorState change, only on toString', () => {
    const fromPortableText = vi.fn(() => '<<spied>>');
    registerFormat({
      id: 'spied',
      detect: () => 0.9,
      toPortableText: () => [],
      fromPortableText,
    });

    const value = new RichtextValue('hello', { hint: 'spied' });
    expect(fromPortableText).not.toHaveBeenCalled();

    value.setEditorState({ ...value.editorState });
    expect(fromPortableText).not.toHaveBeenCalled();

    expect(value.toString()).toBe('<<spied>>');
    expect(fromPortableText).toHaveBeenCalledTimes(1);

    // Memoized: a second call does not re-serialize.
    value.toString();
    expect(fromPortableText).toHaveBeenCalledTimes(1);
  });
});
