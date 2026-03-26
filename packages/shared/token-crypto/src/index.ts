import { createSign, createVerify, generateKeyPairSync, randomBytes } from 'crypto';
import b58 from './bs58.js';

// Export distribution token utilities
export * from './distribution-token.js';
export { b58 };

/**
 * Key pair for Ed25519 signing
 */
export interface Ed25519KeyPair {
  publicKey: string;  // Base64 encoded
  privateKey: string; // Base64 encoded
}

/**
 * Generate a new Ed25519 key pair for token signing
 * @returns Key pair with base64-encoded public and private keys
 */
export function generateKeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: {
      type: 'spki',
      format: 'der',
    },
    privateKeyEncoding: {
      type: 'pkcs8',
      format: 'der',
    },
  });

  return {
    publicKey: b58.encode(publicKey) ,
    privateKey: b58.encode(privateKey),
  };
}

/**
 * Sign data with an Ed25519 private key
 * @param data - Data to sign (typically a JSON payload)
 * @param privateKeyBase64 - Base64-encoded private key
 * @returns Base64-encoded signature
 */
export function sign(data: string, privateKeyBase58: string): string {
  const privateKeyBuffer = Buffer.from(b58.decode(privateKeyBase58));
  
  const signer = createSign('ed25519');
  signer.update(data);
  signer.end();
  
  const signature = signer.sign({
    key: privateKeyBuffer,
    format: 'der',
    type: 'pkcs8',
  });
  
  return b58.encode(signature);
}

/**
 * Verify a signature with an Ed25519 public key
 * @param data - Original data that was signed
 * @param signatureBase64 - Base64-encoded signature
 * @param publicKeyBase64 - Base64-encoded public key
 * @returns True if signature is valid, false otherwise
 */
export function verify(
  data: string,
  signatureBase64: string,
  publicKeyBase64: string
): boolean {
  try {
    const publicKeyBuffer = Buffer.from(b58.decode(publicKeyBase64));
    const signatureBuffer = Buffer.from(b58.decode(signatureBase64));
    
    const verifier = createVerify('ed25519');
    verifier.update(data);
    verifier.end();
    
    return verifier.verify(
      {
        key: publicKeyBuffer,
        format: 'der',
        type: 'spki',
      },
      signatureBuffer
    );
  } catch {
    return false;
  }
}

/**
 * Generate a cryptographically secure random token
 * @param bytes - Number of random bytes to generate (default: 32)
 * @returns Base64-encoded random token
 */
export function generateRandomToken(bytes: number = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Create a signed token payload
 * @param payload - Object to include in the token
 * @param privateKeyBase64 - Base64-encoded private key for signing
 * @returns Object with payload and signature
 */
export function createSignedToken<T extends Record<string, any>>(
  payload: T,
  privateKeyBase64: string
): { payload: T; signature: string } {
  const payloadString = JSON.stringify(payload);
  const signature = sign(payloadString, privateKeyBase64);
  
  return {
    payload,
    signature,
  };
}

/**
 * Verify a signed token payload
 * @param payload - Token payload object
 * @param signature - Base64-encoded signature
 * @param publicKeyBase64 - Base64-encoded public key
 * @returns True if signature is valid, false otherwise
 */
export function verifySignedToken<T extends Record<string, any>>(
  payload: T,
  signature: string,
  publicKeyBase64: string
): boolean {
  const payloadString = JSON.stringify(payload);
  return verify(payloadString, signature, publicKeyBase64);
}
