import { createHash, createHmac, randomInt } from 'node:crypto';

export interface CSRFTokens {
  nonce?: string;
  nonceHmac?: string;
  pkce?: string;
  pkceHash?: string;
  state?: string;
}

export const NONCE_COOKIE_NAME_SUFFIX: keyof CSRFTokens = 'nonce';
export const NONCE_HMAC_COOKIE_NAME_SUFFIX: keyof CSRFTokens = 'nonceHmac';
export const PKCE_COOKIE_NAME_SUFFIX: keyof CSRFTokens = 'pkce';

export const CSRF_CONFIG = {
  secretAllowedCharacters:
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~',
  pkceLength: 43, // Should be between 43 and 128 - per spec
  nonceLength: 16,
  nonceMaxAge: 60 * 60 * 24,
};

/**
 * URL-safe base64 encoding/decoding utilities
 */
export const urlSafe = {
  /**
   * Convert base64 string to URL-safe format
   * Replaces = + / with URL-safe alternatives
   */
  stringify: (b64encodedString: string): string =>
    b64encodedString.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_'),
  
  /**
   * Convert URL-safe string back to standard base64
   */
  parse: (b64encodedString: string): string =>
    b64encodedString.replace(/-/g, '+').replace(/_/g, '/'),
};

/**
 * Get current timestamp in seconds
 */
export function getCurrentTimestampInSeconds(): number {
  return (Date.now() / 1000) | 0;
}

/**
 * Generate a random secret string
 */
export function generateSecret(allowedCharacters: string, secretLength: number): string {
  return [...new Array(secretLength)]
    .map(() => allowedCharacters[randomInt(0, allowedCharacters.length)])
    .join('');
}

/**
 * Generate a nonce with timestamp prefix
 */
export function generateNonce(): string {
  const randomString = generateSecret(
    CSRF_CONFIG.secretAllowedCharacters,
    CSRF_CONFIG.nonceLength
  );
  return `${getCurrentTimestampInSeconds()}T${randomString}`;
}

/**
 * Sign a string using HMAC-SHA256
 */
export function sign(stringToSign: string, secret: string, signatureLength: number): string {
  const digest = createHmac('sha256', secret)
    .update(stringToSign)
    .digest('base64')
    .slice(0, signatureLength);
  return urlSafe.stringify(digest);
}

/**
 * Sign a nonce value
 */
export function signNonce(nonce: string, signingSecret: string): string {
  return sign(nonce, signingSecret, CSRF_CONFIG.nonceLength);
}

/**
 * Generate PKCE verifier and challenge
 */
export function generatePkceVerifier(): { pkce: string; pkceHash: string } {
  const pkce = generateSecret(
    CSRF_CONFIG.secretAllowedCharacters,
    CSRF_CONFIG.pkceLength
  );
  const pkceHash = urlSafe.stringify(
    createHash('sha256').update(pkce, 'utf8').digest('base64')
  );
  return { pkce, pkceHash };
}

/**
 * Generate all CSRF tokens for OAuth flow
 */
export function generateCSRFTokens(redirectURI: string, signingSecret: string): CSRFTokens {
  const nonce = generateNonce();
  const nonceHmac = signNonce(nonce, signingSecret);

  const state = urlSafe.stringify(
    Buffer.from(
      JSON.stringify({
        nonce,
        redirect_uri: redirectURI,
      })
    ).toString('base64')
  );

  return {
    nonce,
    nonceHmac,
    state,
    ...generatePkceVerifier(),
  };
}

/**
 * Parse state parameter to extract redirect URI and nonce
 */
export function parseState(state: string): { nonce: string; redirect_uri: string } {
  return JSON.parse(
    Buffer.from(urlSafe.parse(state), 'base64').toString()
  );
}

/**
 * Validate CSRF tokens from cookies against state parameter
 */
export function validateCSRFTokens(
  state: string,
  nonce: string | undefined,
  nonceHmac: string | undefined,
  pkce: string | undefined,
  signingSecret: string
): void {
  const parsedState = parseState(state);

  if (!parsedState.nonce || !nonce || parsedState.nonce !== nonce) {
    if (!nonce) {
      throw new Error(
        "Your browser didn't send the nonce cookie along, but it is required for security (prevent CSRF)."
      );
    }
    throw new Error(
      'Nonce mismatch. This can happen if you start multiple authentication attempts in parallel (e.g. in separate tabs)'
    );
  }

  if (!pkce) {
    throw new Error(
      "Your browser didn't send the pkce cookie along, but it is required for security (prevent CSRF)."
    );
  }

  const calculatedHmac = signNonce(parsedState.nonce, signingSecret);

  if (calculatedHmac !== nonceHmac) {
    throw new Error(`Nonce signature mismatch! Expected ${calculatedHmac} but got ${nonceHmac}`);
  }
}