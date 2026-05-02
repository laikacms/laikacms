import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTOTP, generateTOTPSecret, verifyTOTP } from './totp.js';

// RFC 6238 test secret: "12345678901234567890" (20 ASCII bytes) base32-encoded.
// base32(31 32 33 34 35 36 37 38 39 30 31 32 33 34 35 36 37 38 39 30)
// = GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const RFC6238_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

// RFC 6238 Appendix B test vectors for the SHA-1 variant. The 8-digit codes
// from the spec are truncated to the trailing 6 digits because this
// implementation uses TOTP_DIGITS=6.
const RFC6238_VECTORS: Array<{ time: number, code: string }> = [
  { time: 59, code: '287082' },
  { time: 1111111109, code: '081804' },
  { time: 1111111111, code: '050471' },
  { time: 1234567890, code: '005924' },
  { time: 2000000000, code: '279037' },
];

describe('generateTOTP (RFC 6238 known-answer vectors)', () => {
  for (const { time, code } of RFC6238_VECTORS) {
    it(`matches the spec at T=${time}`, async () => {
      expect(await generateTOTP(RFC6238_SECRET, time * 1000)).toBe(code);
    });
  }
});

describe('generateTOTP (general behavior)', () => {
  it('returns a 6-digit zero-padded numeric string', async () => {
    const secret = generateTOTPSecret();
    const code = await generateTOTP(secret, Date.now());
    expect(code).toMatch(/^\d{6}$/);
  });

  it('produces the same code at the same time step', async () => {
    const secret = generateTOTPSecret();
    const t = 1_700_000_000_000;
    expect(await generateTOTP(secret, t)).toBe(await generateTOTP(secret, t + 5_000));
  });

  it('produces a different code in the next 30s window', async () => {
    const secret = generateTOTPSecret();
    const t = 1_700_000_000_000;
    const a = await generateTOTP(secret, t);
    const b = await generateTOTP(secret, t + 30_000);
    // Codes can collide by chance (1 in 1M); use a slightly later step
    // to make the probability negligible if the first comparison matched.
    if (a === b) {
      expect(await generateTOTP(secret, t + 60_000)).not.toBe(a);
    } else {
      expect(a).not.toBe(b);
    }
  });

  it('throws on a secret with invalid Base32 characters', async () => {
    await expect(generateTOTP('not-base32!!!', Date.now())).rejects.toThrow(/Base32/);
  });
});

describe('generateTOTPSecret', () => {
  it('returns Base32 characters only (RFC 4648 alphabet)', () => {
    expect(generateTOTPSecret()).toMatch(/^[A-Z2-7]+$/);
  });

  it('produces a different secret each call', () => {
    expect(generateTOTPSecret()).not.toBe(generateTOTPSecret());
  });

  it('produces 32 characters (160-bit secret in Base32)', () => {
    // 20 bytes * 8 bits / 5 bits per char = 32 chars
    expect(generateTOTPSecret().length).toBe(32);
  });
});

describe('verifyTOTP', () => {
  const FIXED_TIME = 1234567890 * 1000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_TIME);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('accepts the current time-step code', async () => {
    expect(await verifyTOTP(RFC6238_SECRET, '005924')).toBe(true);
  });

  it('rejects a wrong code', async () => {
    expect(await verifyTOTP(RFC6238_SECRET, '000000')).toBe(false);
  });

  it('strips whitespace from the input code', async () => {
    expect(await verifyTOTP(RFC6238_SECRET, '005 924')).toBe(true);
    expect(await verifyTOTP(RFC6238_SECRET, ' 005924 ')).toBe(true);
  });

  it('rejects codes with the wrong digit count', async () => {
    expect(await verifyTOTP(RFC6238_SECRET, '12345')).toBe(false);
    expect(await verifyTOTP(RFC6238_SECRET, '1234567')).toBe(false);
  });

  it('accepts the previous time-step code within window=1 (clock drift)', async () => {
    // Generate the code for the previous 30s step and verify it succeeds.
    const previousCode = await generateTOTP(RFC6238_SECRET, FIXED_TIME - 30_000);
    expect(await verifyTOTP(RFC6238_SECRET, previousCode, 1)).toBe(true);
  });

  it('rejects codes outside the window', async () => {
    // A code from 5 minutes ago should not validate with the default window.
    const oldCode = await generateTOTP(RFC6238_SECRET, FIXED_TIME - 5 * 60_000);
    expect(await verifyTOTP(RFC6238_SECRET, oldCode, 1)).toBe(false);
  });

  it('respects window=0 (no drift allowance)', async () => {
    const previousCode = await generateTOTP(RFC6238_SECRET, FIXED_TIME - 30_000);
    expect(await verifyTOTP(RFC6238_SECRET, previousCode, 0)).toBe(false);
  });
});
