import { beforeEach, describe, expect, it } from 'vitest';

import {
  createKeyGenerator,
  createRichtextValue,
  detectMapper,
  getMapper,
  hasMapper,
  listMappers,
  type Mapper,
  type PortableTextDocument,
  registerMapper,
  RichtextValue,
  stripKeys,
  unregisterMapper,
} from '../index';

function makeMapper(id: string, detectScore = 0): Mapper {
  return {
    id,
    label: id,
    toPortableText(value) {
      if (value === '') return [];
      return [
        {
          _type: 'block',
          style: 'normal',
          markDefs: [],
          children: [{ _type: 'span', text: value, marks: [] }],
        },
      ] as unknown as PortableTextDocument;
    },
    fromPortableText(doc) {
      const block = doc[0] as { children?: Array<{ text?: string }> } | undefined;
      return block?.children?.[0]?.text ?? '';
    },
    detect: () => detectScore,
  };
}

describe('mapper registry', () => {
  beforeEach(() => {
    for (const m of listMappers()) unregisterMapper(m.id);
  });

  it('registers, looks up and lists mappers', () => {
    const a = makeMapper('a');
    registerMapper(a);
    expect(hasMapper('a')).toBe(true);
    expect(getMapper('a')).toBe(a);
    expect(listMappers()).toEqual([a]);
  });

  it('throws when looking up an unknown mapper', () => {
    expect(() => getMapper('missing')).toThrow(/no mapper registered/);
  });
});

describe('detectMapper', () => {
  beforeEach(() => {
    for (const m of listMappers()) unregisterMapper(m.id);
  });

  it('picks the highest-scoring mapper', () => {
    registerMapper(makeMapper('a', 0.1));
    registerMapper(makeMapper('b', 0.8));
    registerMapper(makeMapper('c', 0.4));
    expect(detectMapper('anything')).toBe('b');
  });

  it('uses the hint as tiebreaker when scores are within EPSILON', () => {
    registerMapper(makeMapper('a', 0.8));
    registerMapper(makeMapper('b', 0.75));
    expect(detectMapper('anything', 'b')).toBe('b');
    expect(detectMapper('anything', 'a')).toBe('a');
  });

  it('falls back to the hint when no mapper scores above 0', () => {
    registerMapper(makeMapper('a', 0));
    expect(detectMapper('anything', 'a')).toBe('a');
  });
});

describe('createKeyGenerator / stripKeys', () => {
  it('produces deterministic, prefixed keys', () => {
    const gen = createKeyGenerator('b');
    expect(gen()).toBe('b0');
    expect(gen()).toBe('b1');
    expect(gen()).toBe('b2');
  });

  it('strips `_key` recursively', () => {
    const input = [{ _key: 'a', _type: 'block', children: [{ _key: 'c', text: 'x' }] }];
    expect(stripKeys(input)).toEqual([{ _type: 'block', children: [{ text: 'x' }] }]);
  });
});

describe('RichtextValue', () => {
  beforeEach(() => {
    for (const m of listMappers()) unregisterMapper(m.id);
  });

  it('parses raw input via the detected mapper', () => {
    registerMapper(makeMapper('demo', 1));
    const v = createRichtextValue('hello');
    expect(v.inputFormat).toBe('demo');
    expect((v.portableText[0] as { children: { text: string }[] }).children[0]?.text).toBe(
      'hello',
    );
  });

  it('serializes lazily and memoises until PT or output format changes', () => {
    const calls = { from: 0 };
    const m: Mapper = {
      id: 'spy',
      toPortableText: () => [] as PortableTextDocument,
      fromPortableText: () => {
        calls.from += 1;
        return 'serialized';
      },
      detect: () => 1,
    };
    registerMapper(m);
    const v = new RichtextValue('', { hint: 'spy' });
    expect(calls.from).toBe(0); // construction doesn't serialise
    v.toString();
    v.toString();
    expect(calls.from).toBe(1); // memoised
    v.setPortableText([]);
    v.toString();
    expect(calls.from).toBe(2); // PT change invalidates
  });
});
