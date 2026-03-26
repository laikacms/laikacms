import { EncryptJWT } from 'jose/jwt/encrypt';
import { calculateJwkThumbprint } from 'jose/jwk/thumbprint';
import * as base64url from 'jose/base64url';
import { getDerivedEncryptionKey, alg, enc } from './jwe-common.js';

const DEFAULT_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

const now = () => (Date.now() / 1000) | 0;

type Digest = Parameters<typeof calculateJwkThumbprint>[1];

/**
 * Encrypt a payload into a JWE token
 * 
 * @param payload - The data to encrypt
 * @param secret - The secret key material (or array of secrets for rotation)
 * @param salt - Salt for key derivation (e.g., cookie name)
 * @param maxAge - Token expiration in seconds (default: 30 days)
 * @returns Encrypted JWE token string
 */
export async function encrypt<T extends Record<string, unknown>>(
  payload: T,
  secret: string | string[],
  salt: string,
  maxAge: number = DEFAULT_MAX_AGE
): Promise<string> {
  const secrets = Array.isArray(secret) ? secret : [secret];
  const encryptionSecret = await getDerivedEncryptionKey(enc, secrets[0], salt);

  const thumbprint = await calculateJwkThumbprint(
    { kty: 'oct', k: base64url.encode(encryptionSecret) },
    `sha${encryptionSecret.byteLength << 3}` as Digest
  );

  return await new EncryptJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg, enc, kid: thumbprint })
    .setIssuedAt()
    .setExpirationTime(now() + maxAge)
    .setJti(crypto.randomUUID())
    .encrypt(encryptionSecret);
}