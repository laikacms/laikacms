/**
 * Constant-time comparison utilities using standard Web Crypto API
 *
 * Uses HMAC-based comparison for timing-safe equality checks.
 * This is a standard cryptographic technique that works in all environments.
 */

/**
 * Constant-time string comparison to prevent timing attacks.
 * Uses HMAC comparison - if two values produce the same HMAC with the same key, they are equal.
 *
 * @param a - First string to compare
 * @param b - Second string to compare
 * @returns true if strings are equal, false otherwise
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const bufA = encoder.encode(a)
  const bufB = encoder.encode(b)

  return constantTimeEqualBuffer(bufA, bufB)
}

/**
 * Constant-time buffer comparison using HMAC.
 * Uses crypto.subtle.sign to compute HMACs and compare them.
 *
 * @param a - First buffer to compare
 * @param b - Second buffer to compare
 * @returns true if buffers are equal, false otherwise
 */
export async function constantTimeEqualBuffer(a: Uint8Array, b: Uint8Array): Promise<boolean> {
  // Generate a random key for HMAC
  const key = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  // Copy to new ArrayBuffers to avoid SharedArrayBuffer issues
  const bufferA = new Uint8Array(a).buffer as ArrayBuffer
  const bufferB = new Uint8Array(b).buffer as ArrayBuffer

  // Compute HMAC of both values
  const [hmacA, hmacB] = await Promise.all([
    crypto.subtle.sign('HMAC', key, bufferA),
    crypto.subtle.sign('HMAC', key, bufferB),
  ])

  // Compare the HMACs byte by byte
  // Since HMACs are fixed length (32 bytes for SHA-256), this comparison is constant-time
  const viewA = new Uint8Array(hmacA)
  const viewB = new Uint8Array(hmacB)

  let result = 0
  for (let i = 0; i < viewA.length; i++) {
    result |= viewA[i] ^ viewB[i]
  }

  return result === 0
}
