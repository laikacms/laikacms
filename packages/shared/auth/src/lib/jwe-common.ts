import { hkdf } from '@panva/hkdf';

export const alg = 'dir';
export const enc = 'A256CBC-HS512';

/**
 * Derive an encryption key from a secret and salt using HKDF
 */
export async function getDerivedEncryptionKey(
  enc: string,
  keyMaterial: string,
  salt: string
): Promise<Uint8Array> {
  let length: number;
  switch (enc) {
    case 'A256CBC-HS512':
      length = 64;
      break;
    case 'A256GCM':
      length = 32;
      break;
    default:
      throw new Error('Unsupported JWT Content Encryption Algorithm');
  }
  return await hkdf(
    'sha256',
    keyMaterial,
    salt,
    `CookieAuth Generated Encryption Key (${salt})`,
    length
  );
}