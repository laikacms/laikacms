import { describe, expect, it } from 'vitest';
import { sha256, sha256Raw, sha512, sha512Raw } from './hash.js';

// Known-answer vectors from NIST / FIPS 180-4.
// SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
// SHA-512("abc") = ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a
//                  2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f

const SHA256_ABC_HEX = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
const SHA512_ABC_HEX = 'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a'
  + '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f';

const SHA256_EMPTY_HEX = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

describe('sha256', () => {
  it('matches the FIPS 180-4 vector for "abc"', async () => {
    const out = await sha256('abc');
    expect(bytesToHex(base64UrlToBytes(out))).toBe(SHA256_ABC_HEX);
  });

  it('produces base64url output (no +, /, or =)', async () => {
    const out = await sha256('hello world');
    expect(out).not.toMatch(/[+/=]/);
  });

  it('is deterministic', async () => {
    expect(await sha256('repeat')).toBe(await sha256('repeat'));
  });

  it('produces different output for different input', async () => {
    expect(await sha256('a')).not.toBe(await sha256('b'));
  });
});

describe('sha512', () => {
  it('matches the FIPS 180-4 vector for "abc"', async () => {
    const out = await sha512('abc');
    expect(bytesToHex(base64UrlToBytes(out))).toBe(SHA512_ABC_HEX);
  });

  it('produces 64-byte output (86 base64url chars without padding)', async () => {
    const out = await sha512('anything');
    // 64 bytes -> ceil(64*4/3) = 86 base64url chars without padding.
    expect(out.length).toBe(86);
  });

  it('is deterministic and unique per input', async () => {
    expect(await sha512('x')).toBe(await sha512('x'));
    expect(await sha512('x')).not.toBe(await sha512('y'));
  });
});

describe('sha256Raw', () => {
  it('matches the empty-string vector', async () => {
    expect(bytesToHex(await sha256Raw(''))).toBe(SHA256_EMPTY_HEX);
  });

  it('produces 32-byte output', async () => {
    expect((await sha256Raw('test')).length).toBe(32);
  });

  it('treats string and equivalent ArrayBuffer input identically', async () => {
    const fromString = await sha256Raw('payload');
    const fromBuffer = await sha256Raw(
      new TextEncoder().encode('payload').buffer as ArrayBuffer,
    );
    expect(bytesToHex(fromString)).toBe(bytesToHex(fromBuffer));
  });
});

describe('sha512Raw', () => {
  it('produces 64-byte output', async () => {
    expect((await sha512Raw('test')).length).toBe(64);
  });

  it('matches the FIPS vector for "abc"', async () => {
    expect(bytesToHex(await sha512Raw('abc'))).toBe(SHA512_ABC_HEX);
  });
});
