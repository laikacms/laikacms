import { jwtDecrypt } from 'jose/jwt/decrypt';
import { calculateJwkThumbprint } from 'jose/jwk/thumbprint';
import * as base64url from 'jose/base64url';
import { getDerivedEncryptionKey, alg, enc } from './jwe-common.js';
import { DecryptedToken } from '../types.js';

type Digest = Parameters<typeof calculateJwkThumbprint>[1];

/**
 * Decrypt a JWE token and return the payload
 * Supports multiple secrets for key rotation
 * 
 * @param token - The JWE token string
 * @param secret - The secret key material (or array of secrets for rotation)
 * @param salt - Salt for key derivation (must match encryption)
 * @returns Decrypted payload or null if decryption fails
 */
export async function decrypt(
  token: string,
  secret: string | string[],
  salt: string
): Promise<DecryptedToken | null> {
  if (!token) return null;

  const secrets = Array.isArray(secret) ? secret : [secret];

  try {
    const { payload } = await jwtDecrypt(
      token,
      async (jwe) => {
        const { kid, enc: tokenEnc } = jwe;
        for (const s of secrets) {
          const encryptionSecret = await getDerivedEncryptionKey(
            tokenEnc,
            s,
            salt
          );

          // If no kid in token, return first secret
          if (kid === undefined) return encryptionSecret;

          // Match by thumbprint
          const thumbprint = await calculateJwkThumbprint(
            { kty: 'oct', k: base64url.encode(encryptionSecret) },
            `sha${encryptionSecret.byteLength << 3}` as Digest
          );

          if (kid === thumbprint) return encryptionSecret;
        }

        throw new Error('No matching decryption secret');
      },
      {
        clockTolerance: 15,
        keyManagementAlgorithms: [alg],
        contentEncryptionAlgorithms: [enc, 'A256GCM'],
      }
    );

    return payload as unknown as DecryptedToken;
  } catch {
    // Token is invalid, expired, or tampered with
    return null;
  }
}