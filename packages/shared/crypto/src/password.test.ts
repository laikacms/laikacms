import { describe, expect, it } from 'vitest';
import { hashPassword, needsRehash, PASSWORD_CONSTANTS, verifyPassword } from './password.js';

describe('hashPassword', () => {
  it('produces a bcrypt hash that verifies against the original password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^\$2[aby]?\$/);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('uses at least MIN_ROUNDS even when given a smaller value', async () => {
    const hash = await hashPassword('pw', 4);
    const rounds = parseInt(hash.split('$')[2], 10);
    expect(rounds).toBeGreaterThanOrEqual(PASSWORD_CONSTANTS.MIN_ROUNDS);
  });

  it('produces a different hash each time (random salt)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
  });

  it('rejects empty passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow(/Invalid password/);
  });

  it('rejects passwords above MAX_PASSWORD_LENGTH', async () => {
    const tooLong = 'a'.repeat(PASSWORD_CONSTANTS.MAX_PASSWORD_LENGTH + 1);
    await expect(hashPassword(tooLong)).rejects.toThrow(/Invalid password/);
  });

  it('rejects non-string inputs', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await expect(hashPassword(undefined as any)).rejects.toThrow(/Invalid password/);
  });
});

describe('verifyPassword', () => {
  it('returns true for the matching password', async () => {
    const hash = await hashPassword('s3cret');
    expect(await verifyPassword('s3cret', hash)).toBe(true);
  });

  it('returns false for a wrong password', async () => {
    const hash = await hashPassword('s3cret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('returns false (without throwing) for an empty input password', async () => {
    const hash = await hashPassword('s3cret');
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('returns false (without throwing) for an invalidly formatted hash', async () => {
    expect(await verifyPassword('s3cret', 'not-a-bcrypt-hash')).toBe(false);
  });

  it('returns false (without throwing) for an over-long input password', async () => {
    const tooLong = 'a'.repeat(PASSWORD_CONSTANTS.MAX_PASSWORD_LENGTH + 1);
    const hash = await hashPassword('anything');
    expect(await verifyPassword(tooLong, hash)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('returns true for non-bcrypt strings', () => {
    expect(needsRehash('plaintext-password')).toBe(true);
    expect(needsRehash('')).toBe(true);
  });

  it('returns true when stored rounds are below the target', () => {
    const lowRoundsHash = '$2a$08$' + 'x'.repeat(53);
    expect(needsRehash(lowRoundsHash, 12)).toBe(true);
  });

  it('returns false when stored rounds meet or exceed the target', () => {
    const goodHash = '$2a$14$' + 'x'.repeat(53);
    expect(needsRehash(goodHash, 12)).toBe(false);
    expect(needsRehash(goodHash, 14)).toBe(false);
  });

  it('returns true when the format has no parseable rounds segment', () => {
    expect(needsRehash('$2a$invalid')).toBe(true);
  });

  it('handles the $2b and $2y bcrypt variants', () => {
    expect(needsRehash('$2b$12$' + 'x'.repeat(53), 12)).toBe(false);
    expect(needsRehash('$2y$12$' + 'x'.repeat(53), 12)).toBe(false);
  });
});
