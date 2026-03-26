import { describe, it, expect } from 'vitest';
import {
  generateCSRFTokens,
  validateCSRFTokens,
  parseState,
  generateNonce,
  generatePkceVerifier,
  signNonce,
  urlSafe,
} from '../src/lib/csrf.js';

describe('CSRF utilities', () => {
  const signingSecret = 'test-csrf-signing-secret-here!!';

  describe('urlSafe', () => {
    it('should convert base64 to URL-safe format', () => {
      const base64 = 'abc+def/ghi=';
      const urlSafeStr = urlSafe.stringify(base64);
      
      expect(urlSafeStr).toBe('abc-def_ghi');
      expect(urlSafeStr).not.toContain('+');
      expect(urlSafeStr).not.toContain('/');
      expect(urlSafeStr).not.toContain('=');
    });

    it('should convert URL-safe back to base64', () => {
      const urlSafeStr = 'abc-def_ghi';
      const base64 = urlSafe.parse(urlSafeStr);
      
      expect(base64).toBe('abc+def/ghi');
    });
  });

  describe('generateNonce', () => {
    it('should generate a nonce with timestamp prefix', () => {
      const nonce = generateNonce();
      
      expect(nonce).toBeDefined();
      expect(nonce).toContain('T');
      
      // Split only on the first 'T' since random part may contain 'T'
      const firstTIndex = nonce.indexOf('T');
      const timestamp = nonce.slice(0, firstTIndex);
      const random = nonce.slice(firstTIndex + 1);
      
      expect(parseInt(timestamp)).toBeGreaterThan(0);
      expect(random.length).toBe(16);
    });

    it('should generate unique nonces', () => {
      const nonce1 = generateNonce();
      const nonce2 = generateNonce();
      
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('generatePkceVerifier', () => {
    it('should generate PKCE verifier and hash', () => {
      const { pkce, pkceHash } = generatePkceVerifier();
      
      expect(pkce).toBeDefined();
      expect(pkce.length).toBe(43);
      expect(pkceHash).toBeDefined();
      expect(pkceHash.length).toBeGreaterThan(0);
    });

    it('should generate unique PKCE values', () => {
      const pkce1 = generatePkceVerifier();
      const pkce2 = generatePkceVerifier();
      
      expect(pkce1.pkce).not.toBe(pkce2.pkce);
      expect(pkce1.pkceHash).not.toBe(pkce2.pkceHash);
    });
  });

  describe('signNonce', () => {
    it('should sign a nonce', () => {
      const nonce = generateNonce();
      const signature = signNonce(nonce, signingSecret);
      
      expect(signature).toBeDefined();
      expect(signature.length).toBe(16);
    });

    it('should produce consistent signatures', () => {
      const nonce = '1234567890T0123456789abcdef';
      const sig1 = signNonce(nonce, signingSecret);
      const sig2 = signNonce(nonce, signingSecret);
      
      expect(sig1).toBe(sig2);
    });

    it('should produce different signatures for different nonces', () => {
      const sig1 = signNonce('nonce1', signingSecret);
      const sig2 = signNonce('nonce2', signingSecret);
      
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('generateCSRFTokens', () => {
    it('should generate all CSRF tokens', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      expect(tokens.nonce).toBeDefined();
      expect(tokens.nonceHmac).toBeDefined();
      expect(tokens.pkce).toBeDefined();
      expect(tokens.pkceHash).toBeDefined();
      expect(tokens.state).toBeDefined();
    });

    it('should encode redirect URI in state', () => {
      const redirectUri = 'https://example.com/dashboard?foo=bar';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      const parsed = parseState(tokens.state!);
      expect(parsed.redirect_uri).toBe(redirectUri);
      expect(parsed.nonce).toBe(tokens.nonce);
    });
  });

  describe('validateCSRFTokens', () => {
    it('should validate correct CSRF tokens', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tokens.nonce,
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).not.toThrow();
    });

    it('should throw on missing nonce', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          undefined,
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow("Your browser didn't send the nonce cookie along");
    });

    it('should throw on nonce mismatch', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          'wrong-nonce',
          tokens.nonceHmac,
          tokens.pkce,
          signingSecret
        );
      }).toThrow('Nonce mismatch');
    });

    it('should throw on missing PKCE', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
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

    it('should throw on HMAC mismatch', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tokens.nonce,
          'wrong-hmac',
          tokens.pkce,
          signingSecret
        );
      }).toThrow('Nonce signature mismatch');
    });

    it('should throw on wrong signing secret', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      expect(() => {
        validateCSRFTokens(
          tokens.state!,
          tokens.nonce,
          tokens.nonceHmac,
          tokens.pkce,
          'wrong-secret'
        );
      }).toThrow('Nonce signature mismatch');
    });
  });

  describe('parseState', () => {
    it('should parse state parameter', () => {
      const redirectUri = 'https://example.com/dashboard';
      const tokens = generateCSRFTokens(redirectUri, signingSecret);
      
      const parsed = parseState(tokens.state!);
      
      expect(parsed.redirect_uri).toBe(redirectUri);
      expect(parsed.nonce).toBe(tokens.nonce);
    });
  });
});