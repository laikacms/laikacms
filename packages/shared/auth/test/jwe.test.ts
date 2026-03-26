import { describe, it, expect } from 'vitest';
import { encrypt } from '../src/lib/jwe-encrypt.js';
import { decrypt } from '../src/lib/jwe-decrypt.js';

describe('JWE encryption/decryption', () => {
  const secret = 'test-secret-key-32-characters!!';
  const salt = 'test.cookie';

  it('should encrypt and decrypt a payload', async () => {
    const payload = { token: 'my-secret-token', userId: '123' };
    
    const encrypted = await encrypt(payload, secret, salt);
    
    expect(encrypted).toBeDefined();
    expect(typeof encrypted).toBe('string');
    expect(encrypted).not.toContain('my-secret-token'); // Should be encrypted
    
    const decrypted = await decrypt<typeof payload>(encrypted, secret, salt);
    
    expect(decrypted).toBeDefined();
    expect(decrypted?.token).toBe('my-secret-token');
    expect(decrypted?.userId).toBe('123');
  });

  it('should return null for invalid token', async () => {
    const result = await decrypt('invalid-token', secret, salt);
    expect(result).toBeNull();
  });

  it('should return null for empty token', async () => {
    const result = await decrypt('', secret, salt);
    expect(result).toBeNull();
  });

  it('should fail decryption with wrong secret', async () => {
    const payload = { token: 'my-secret-token' };
    const encrypted = await encrypt(payload, secret, salt);
    
    const result = await decrypt(encrypted, 'wrong-secret-key-32-characters!!', salt);
    expect(result).toBeNull();
  });

  it('should fail decryption with wrong salt', async () => {
    const payload = { token: 'my-secret-token' };
    const encrypted = await encrypt(payload, secret, salt);
    
    const result = await decrypt(encrypted, secret, 'wrong.salt');
    expect(result).toBeNull();
  });

  it('should support key rotation with multiple secrets', async () => {
    const oldSecret = 'old-secret-key-32-characters!!!';
    const newSecret = 'new-secret-key-32-characters!!!';
    
    // Encrypt with old secret
    const payload = { token: 'my-secret-token' };
    const encrypted = await encrypt(payload, oldSecret, salt);
    
    // Decrypt with array of secrets (new first, old second)
    const decrypted = await decrypt<typeof payload>(
      encrypted,
      [newSecret, oldSecret],
      salt
    );
    
    expect(decrypted?.token).toBe('my-secret-token');
  });

  it('should encrypt with first secret in array', async () => {
    const secrets = ['primary-secret-32-characters!!!!', 'secondary-secret-32-characters!'];
    
    const payload = { token: 'my-secret-token' };
    const encrypted = await encrypt(payload, secrets, salt);
    
    // Should be decryptable with primary secret alone
    const decrypted = await decrypt<typeof payload>(encrypted, secrets[0], salt);
    expect(decrypted?.token).toBe('my-secret-token');
  });

  it('should include expiration in token', async () => {
    const payload = { token: 'my-secret-token' };
    const maxAge = 1; // 1 second
    
    const encrypted = await encrypt(payload, secret, salt, maxAge);
    
    // Should work immediately
    const decrypted1 = await decrypt<{ token: string; exp?: number }>(encrypted, secret, salt);
    expect(decrypted1?.token).toBe('my-secret-token');
    
    // Verify exp claim is set (accounting for 15s clock tolerance in decrypt)
    expect(decrypted1?.exp).toBeDefined();
    expect(typeof decrypted1?.exp).toBe('number');
    
    // The exp should be approximately now + maxAge
    const now = Math.floor(Date.now() / 1000);
    expect(decrypted1?.exp).toBeGreaterThanOrEqual(now);
    expect(decrypted1?.exp).toBeLessThanOrEqual(now + maxAge + 2); // Allow 2s tolerance
  });
});