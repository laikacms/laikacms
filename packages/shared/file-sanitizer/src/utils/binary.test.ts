import { describe, expect, it } from 'vitest';
import {
  bytesEqual,
  concatBytes,
  findBytes,
  readFixedString,
  readNullTerminatedString,
  readUint16BE,
  readUint16LE,
  readUint32BE,
  readUint32LE,
  sliceBytes,
  spliceOutRanges,
  startsWith,
  writeUint16BE,
  writeUint16LE,
  writeUint32BE,
  writeUint32LE,
} from './binary.js';

describe('readUint16BE / writeUint16BE', () => {
  it('roundtrips values within range', () => {
    for (const value of [0, 1, 0xff, 0x1234, 0xffff]) {
      const buf = new Uint8Array(2);
      writeUint16BE(buf, 0, value);
      expect(readUint16BE(buf, 0)).toBe(value);
    }
  });

  it('uses big-endian byte order', () => {
    expect(readUint16BE(new Uint8Array([0x12, 0x34]), 0)).toBe(0x1234);
  });
});

describe('readUint16LE / writeUint16LE', () => {
  it('roundtrips and uses little-endian byte order', () => {
    const buf = new Uint8Array(2);
    writeUint16LE(buf, 0, 0x1234);
    expect(buf[0]).toBe(0x34);
    expect(buf[1]).toBe(0x12);
    expect(readUint16LE(buf, 0)).toBe(0x1234);
  });
});

describe('readUint32BE / writeUint32BE', () => {
  it('handles values above 2^31 as unsigned', () => {
    const buf = new Uint8Array(4);
    writeUint32BE(buf, 0, 0xdeadbeef);
    expect(readUint32BE(buf, 0)).toBe(0xdeadbeef);
    expect(readUint32BE(buf, 0)).toBeGreaterThan(0);
  });

  it('roundtrips zero and max values', () => {
    const buf = new Uint8Array(4);
    writeUint32BE(buf, 0, 0);
    expect(readUint32BE(buf, 0)).toBe(0);
    writeUint32BE(buf, 0, 0xffffffff);
    expect(readUint32BE(buf, 0)).toBe(0xffffffff);
  });
});

describe('readUint32LE / writeUint32LE', () => {
  it('roundtrips a known value with reversed byte order', () => {
    const buf = new Uint8Array(4);
    writeUint32LE(buf, 0, 0x12345678);
    expect(Array.from(buf)).toEqual([0x78, 0x56, 0x34, 0x12]);
    expect(readUint32LE(buf, 0)).toBe(0x12345678);
  });
});

describe('bytesEqual', () => {
  it('returns true for matching ranges', () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([0, 1, 2, 3, 4]);
    expect(bytesEqual(a, b, 0, 1, 4)).toBe(true);
  });

  it('returns false on the first differing byte', () => {
    expect(bytesEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 9, 3]))).toBe(false);
  });

  it('returns true for two empty slices', () => {
    expect(bytesEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
  });
});

describe('findBytes', () => {
  it('returns the index of the first match', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    expect(findBytes(data, new Uint8Array([3, 4]))).toBe(2);
  });

  it('returns -1 when the pattern is absent', () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(findBytes(data, new Uint8Array([9, 9]))).toBe(-1);
  });

  it('respects the start offset', () => {
    const data = new Uint8Array([1, 2, 1, 2]);
    expect(findBytes(data, new Uint8Array([1, 2]), 1)).toBe(2);
  });
});

describe('concatBytes', () => {
  it('joins multiple buffers in order', () => {
    const out = concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5]));
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns an empty array when given no inputs', () => {
    expect(concatBytes().length).toBe(0);
  });
});

describe('sliceBytes', () => {
  it('returns a copy (mutating the result does not affect the source)', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const out = sliceBytes(src, 1, 3);
    out[0] = 99;
    expect(src[1]).toBe(2);
  });
});

describe('spliceOutRanges', () => {
  it('returns the input reference unchanged when no ranges are given', () => {
    const src = new Uint8Array([1, 2, 3]);
    expect(spliceOutRanges(src, [])).toBe(src);
  });

  it('removes a single middle range', () => {
    const src = new Uint8Array([1, 2, 3, 4, 5]);
    const out = spliceOutRanges(src, [[1, 3]]);
    expect(Array.from(out)).toEqual([1, 4, 5]);
  });

  it('removes multiple non-overlapping ranges', () => {
    const src = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const out = spliceOutRanges(src, [[1, 3], [5, 7]]);
    expect(Array.from(out)).toEqual([0, 3, 4, 7, 8, 9]);
  });

  it('removes a range at the very end of the buffer', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const out = spliceOutRanges(src, [[2, 4]]);
    expect(Array.from(out)).toEqual([1, 2]);
  });

  it('removes a range at the very start of the buffer', () => {
    const src = new Uint8Array([1, 2, 3, 4]);
    const out = spliceOutRanges(src, [[0, 2]]);
    expect(Array.from(out)).toEqual([3, 4]);
  });
});

describe('startsWith', () => {
  it('matches a number[] prefix', () => {
    expect(startsWith(new Uint8Array([1, 2, 3]), [1, 2])).toBe(true);
  });

  it('rejects when the data is shorter than the pattern', () => {
    expect(startsWith(new Uint8Array([1]), [1, 2])).toBe(false);
  });

  it('matches a Uint8Array prefix', () => {
    expect(startsWith(new Uint8Array([0x89, 0x50]), new Uint8Array([0x89, 0x50]))).toBe(true);
  });
});

describe('readNullTerminatedString', () => {
  it('stops at the first null byte', () => {
    const data = new Uint8Array([0x68, 0x69, 0x00, 0x21]); // "hi\0!"
    expect(readNullTerminatedString(data, 0)).toBe('hi');
  });

  it('respects maxLength', () => {
    const data = new Uint8Array([0x68, 0x69, 0x21]); // no null
    expect(readNullTerminatedString(data, 0, 2)).toBe('hi');
  });
});

describe('readFixedString', () => {
  it('reads exactly `length` bytes (or stops at null)', () => {
    const data = new Uint8Array([0x66, 0x6f, 0x6f, 0x00, 0x62]); // "foo\0b"
    expect(readFixedString(data, 0, 5)).toBe('foo');
  });
});
