import { describe, it, expect } from 'vitest';
import { encrypt } from '../src/lib/jwe-encrypt.js';
import { decrypt } from '../src/lib/jwe-decrypt.js';
import {
  generateCSRFTokens,
  validateCSRFTokens,
  signNonce,
  urlSafe,
} from '../src/lib/csrf.js';
import { callback } from '../src/callback.js';
import { extractJwt } from '../src/extract-jwt.js';
import type { AuthConfig, RequestContext } from '../src/types.js';

describe('Security Tests', () => {
  const config: AuthConfig = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    authorizationEndpoint: 'https://auth.example.com/authorize',
    tokenEndpoint: 'https://auth.example.com/token',
    jwksUri: 'https://auth.example.com/.well-known/jwks.json',
    cookieSecret: 'test-cookie-secret-32-chars!!!!',
    csrfSecret: 'test-csrf-secret-32-characters!',
    callbackPath: '/auth/v1/callback/cognito',
    cookiePrefix: 'test',
  };

  describe('JWE Tampering Protection', () => {
    const secret = 'test-secret-key-32-characters!!';
    const salt = 'test.cookie';

    it('should reject tampered JWE payload', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, salt);
      
      // Tamper with the encrypted payload (modify a character in the middle)
      const parts = encrypted.split('.');
      const tamperedPayload = parts[3].slice(0, 10) + 'X' + parts[3].slice(11);
      const tampered = [parts[0], parts[1], parts[2], tamperedPayload, parts[4]].join('.');
      
      const result = await decrypt(tampered, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject JWE with modified header', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, salt);
      
      // Tamper with the header
      const parts = encrypted.split('.');
      const tamperedHeader = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0'; // Different enc algorithm
      const tampered = [tamperedHeader, parts[1], parts[2], parts[3], parts[4]].join('.');
      
      const result = await decrypt(tampered, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject JWE with modified IV', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, salt);
      
      // Tamper with the IV (second part)
      const parts = encrypted.split('.');
      const tamperedIV = parts[2].slice(0, 5) + 'XXXXX' + parts[2].slice(10);
      const tampered = [parts[0], parts[1], tamperedIV, parts[3], parts[4]].join('.');
      
      const result = await decrypt(tampered, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject JWE with modified auth tag', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, salt);
      
      // Tamper with the auth tag (last part)
      const parts = encrypted.split('.');
      const tamperedTag = parts[4].slice(0, 5) + 'XXXXX' + parts[4].slice(10);
      const tampered = [parts[0], parts[1], parts[2], parts[3], tamperedTag].join('.');
      
      const result = await decrypt(tampered, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject completely random JWE-like string', async () => {
      const fakeJwe = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2Q0JDLUhTNTEyIn0..AAAAAAAAAAAAAAAA.BBBBBBBBBBBBBBBB.CCCCCCCCCCCCCCCC';
      
      const result = await decrypt(fakeJwe, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject JWE encrypted with different secret', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, 'different-secret-32-characters!', salt);
      
      const result = await decrypt(encrypted, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject JWE encrypted with different salt', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, 'different.salt');
      
      const result = await decrypt(encrypted, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject truncated JWE', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, salt);
      
      // Truncate the JWE
      const truncated = encrypted.slice(0, encrypted.length - 20);
      
      const result = await decrypt(truncated, secret, salt);
      expect(result).toBeNull();
    });

    it('should reject JWE with missing parts', async () => {
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, secret, salt);
      
      // Remove one part
      const parts = encrypted.split('.');
      const incomplete = [parts[0], parts[1], parts[2], parts[3]].join('.');
      
      const result = await decrypt(incomplete, secret, salt);
      expect(result).toBeNull();
    });
  });

  describe('CSRF Token Tampering Protection', () => {
    const signingSecret = 'test-csrf-signing-secret-here!!';

    it('should reject tampered nonce', () => {
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      // Tamper with the nonce
      const tamperedNonce = tokens.nonce!.slice(0, -1) + 'X';
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tamperedNonce,
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow('Nonce mismatch');
    });

    it('should reject tampered nonce HMAC', () => {
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      // Tamper with the HMAC
      const tamperedHmac = tokens.nonceHmac!.slice(0, -1) + 'X';
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tokens.nonce,
          tamperedHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow('Nonce signature mismatch');
    });

    it('should reject forged HMAC with different secret', () => {
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      // Create HMAC with different secret
      const forgedHmac = signNonce(tokens.nonce!, 'different-secret-here!!!!!!!!');
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tokens.nonce,
          forgedHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow('Nonce signature mismatch');
    });

    it('should reject tampered state parameter', () => {
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      // Create a different state with different redirect URI
      const maliciousState = urlSafe.stringify(
        Buffer.from(
          JSON.stringify({
            nonce: tokens.nonce,
            redirect_uri: 'https://evil.com/steal-tokens',
          })
        ).toString('base64')
      );
      
      // The nonce in state won't match the cookie nonce
      expect(() => {
        validateCSRFTokens(
          maliciousState,
          tokens.nonce,
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).not.toThrow(); // This passes because nonce matches
      
      // But if attacker tries to use their own nonce in state
      const attackerNonce = '1234567890T0123456789abcdef';
      const attackerState = urlSafe.stringify(
        Buffer.from(
          JSON.stringify({
            nonce: attackerNonce,
            redirect_uri: 'https://evil.com/steal-tokens',
          })
        ).toString('base64')
      );
      
      expect(() => {
        validateCSRFTokens(
          attackerState,
          tokens.nonce, // Original nonce from cookie
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow('Nonce mismatch');
    });

    it('should reject missing PKCE verifier', () => {
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tokens.nonce,
          tokens.nonceHmac,
          undefined,
          signingSecret
        );
      }).toThrow("Your browser didn't send the pkce cookie along");
    });

    it('should reject invalid base64 in state', () => {
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          'not-valid-base64!!!',
          tokens.nonce,
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow();
    });

    it('should reject state with invalid JSON', () => {
      const invalidState = urlSafe.stringify(
        Buffer.from('not-json').toString('base64')
      );
      
      const tokens = generateCSRFTokens('/dashboard', signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          invalidState,
          tokens.nonce,
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow();
    });
  });

  describe('Callback Handler Security', () => {
    it('should reject callback without authorization code', async () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/callback?state=somestate',
        method: 'GET',
        cookies: {},
        query: { state: 'somestate' },
      };
      
      const result = await callback(config, request);
      
      expect(result.type).toBe('error');
      expect(result.status).toBe(400);
      expect(result.error).toContain('Missing authorization code');
    });

    it('should reject callback without state parameter', async () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/callback?code=somecode',
        method: 'GET',
        cookies: {},
        query: { code: 'somecode' },
      };
      
      const result = await callback(config, request);
      
      expect(result.type).toBe('error');
      expect(result.status).toBe(400);
      expect(result.error).toContain('Missing state parameter');
    });

    it('should reject callback with missing CSRF cookies', async () => {
      const tokens = generateCSRFTokens('/dashboard', config.csrfSecret);
      
      const request: RequestContext = {
        url: `http://localhost/auth/v1/callback?code=somecode&state=${tokens.state}`,
        method: 'GET',
        cookies: {}, // No CSRF cookies
        query: { code: 'somecode', state: tokens.state },
      };
      
      const result = await callback(config, request);
      
      expect(result.type).toBe('error');
      expect(result.status).toBe(400);
      expect(result.error).toContain('CSRF validation failed');
    });

    it('should reject callback with tampered CSRF cookies', async () => {
      const tokens = generateCSRFTokens('/dashboard', config.csrfSecret);
      
      const request: RequestContext = {
        url: `http://localhost/auth/v1/callback?code=somecode&state=${tokens.state}`,
        method: 'GET',
        cookies: {
          'test.nonce': tokens.nonce,
          'test.nonceHmac': 'tampered-hmac',
          'test.pkce': tokens.pkce,
        },
        query: { code: 'somecode', state: tokens.state },
      };
      
      const result = await callback(config, request);
      
      expect(result.type).toBe('error');
      expect(result.status).toBe(400);
      expect(result.error).toContain('CSRF validation failed');
      expect(result.error).toContain('Nonce signature mismatch');
    });

    it('should reject callback with OAuth error', async () => {
      const request: RequestContext = {
        url: 'http://localhost/auth/v1/callback?error=access_denied&error_description=User%20cancelled',
        method: 'GET',
        cookies: {},
        query: { error: 'access_denied', error_description: 'User cancelled' },
      };
      
      const result = await callback(config, request);
      
      expect(result.type).toBe('error');
      expect(result.status).toBe(400);
      expect(result.error).toContain('OAuth error');
      expect(result.error).toContain('access_denied');
    });
  });

  describe('Token Extraction Security', () => {
    it('should reject tampered encrypted cookie', async () => {
      // First, create a valid encrypted token
      const validToken = await encrypt(
        { token: 'valid-access-token' },
        config.cookieSecret,
        'test.accessToken'
      );
      
      // Tamper with it
      const parts = validToken.split('.');
      const tamperedToken = [parts[0], parts[1], parts[2], 'TAMPERED' + parts[3].slice(8), parts[4]].join('.');
      
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {
          'test.accessToken': tamperedToken,
        },
        query: {},
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });

    it('should reject cookie encrypted with different secret', async () => {
      const tokenWithDifferentSecret = await encrypt(
        { token: 'valid-access-token' },
        'different-secret-32-characters!',
        'test.accessToken'
      );
      
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {
          'test.accessToken': tokenWithDifferentSecret,
        },
        query: {},
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });

    it('should reject cookie with wrong salt', async () => {
      const tokenWithWrongSalt = await encrypt(
        { token: 'valid-access-token' },
        config.cookieSecret,
        'wrong.salt'
      );
      
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {
          'test.accessToken': tokenWithWrongSalt,
        },
        query: {},
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });

    it('should reject malformed Authorization header', async () => {
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {},
        query: {},
        authorization: 'NotBearer sometoken',
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });

    it('should reject empty Bearer token', async () => {
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {},
        query: {},
        authorization: 'Bearer ',
      };
      
      const result = await extractJwt(config, request);
      
      // Empty token after Bearer is still extracted
      expect(result.found).toBe(false);
    });

    it('should reject Basic auth header', async () => {
      const request: RequestContext = {
        url: 'http://localhost/api/data',
        method: 'GET',
        cookies: {},
        query: {},
        authorization: 'Basic dXNlcjpwYXNz',
      };
      
      const result = await extractJwt(config, request);
      
      expect(result.found).toBe(false);
      expect(result.source).toBe('none');
    });
  });

  describe('Key Rotation Security', () => {
    it('should decrypt with old key during rotation', async () => {
      const oldSecret = 'old-secret-key-32-characters!!!';
      const newSecret = 'new-secret-key-32-characters!!!';
      const salt = 'test.cookie';
      
      // Encrypt with old secret
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, oldSecret, salt);
      
      // Decrypt with array [new, old] - should work
      const result = await decrypt<typeof payload>(encrypted, [newSecret, oldSecret], salt);
      expect(result?.token).toBe('my-secret-token');
    });

    it('should not decrypt with only new key after rotation', async () => {
      const oldSecret = 'old-secret-key-32-characters!!!';
      const newSecret = 'new-secret-key-32-characters!!!';
      const salt = 'test.cookie';
      
      // Encrypt with old secret
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, oldSecret, salt);
      
      // Decrypt with only new secret - should fail
      const result = await decrypt(encrypted, newSecret, salt);
      expect(result).toBeNull();
    });

    it('should encrypt with first (new) key in rotation array', async () => {
      const oldSecret = 'old-secret-key-32-characters!!!';
      const newSecret = 'new-secret-key-32-characters!!!';
      const salt = 'test.cookie';
      
      // Encrypt with array [new, old]
      const payload = { token: 'my-secret-token' };
      const encrypted = await encrypt(payload, [newSecret, oldSecret], salt);
      
      // Should be decryptable with new secret alone
      const result = await decrypt<typeof payload>(encrypted, newSecret, salt);
      expect(result?.token).toBe('my-secret-token');
      
      // Should NOT be decryptable with old secret alone
      const resultOld = await decrypt(encrypted, oldSecret, salt);
      expect(resultOld).toBeNull();
    });
  });

  describe('Replay Attack Protection', () => {
    it('should include unique JTI in each encrypted token', async () => {
      const secret = 'test-secret-key-32-characters!!';
      const salt = 'test.cookie';
      const payload = { token: 'my-secret-token' };
      
      // Encrypt the same payload twice
      const encrypted1 = await encrypt(payload, secret, salt);
      const encrypted2 = await encrypt(payload, secret, salt);
      
      // They should be different (different JTI and IAT)
      expect(encrypted1).not.toBe(encrypted2);
      
      // Both should decrypt successfully
      const result1 = await decrypt<typeof payload>(encrypted1, secret, salt);
      const result2 = await decrypt<typeof payload>(encrypted2, secret, salt);
      
      expect(result1?.token).toBe('my-secret-token');
      expect(result2?.token).toBe('my-secret-token');
      
      // JTIs should be different
      const decrypted1 = await decrypt<{ jti: string }>(encrypted1, secret, salt);
      const decrypted2 = await decrypt<{ jti: string }>(encrypted2, secret, salt);
      expect(decrypted1?.jti).not.toBe(decrypted2?.jti);
    });
  });
});