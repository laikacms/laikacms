/**
 * Security constants for random generation
 */
export const RANDOM_CONSTANTS = {
  /** Default alphabet for URL-safe tokens (base62) */
  BASE62_ALPHABET: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  /** Hex alphabet */
  HEX_ALPHABET: '0123456789abcdef',
  /** Default token length for high security */
  DEFAULT_TOKEN_LENGTH: 64,
  /** Minimum token length for security */
  MIN_TOKEN_LENGTH: 32,
} as const

/**
 * Generate cryptographically secure random strings using rejection sampling.
 * This eliminates modulo bias which could theoretically be exploited
 * by quantum computers with sufficient qubits.
 *
 * Uses base62 alphabet (A-Za-z0-9) for URL-safe tokens by default.
 *
 * @param length - Desired length of the output string
 * @param alphabet - Character set to use (default: base62)
 * @returns Cryptographically secure random string
 */
export function generateSecureRandomString(
  length: number,
  alphabet: string = RANDOM_CONSTANTS.BASE62_ALPHABET
): string {
  const alphabetSize = alphabet.length

  // Calculate the largest multiple of alphabetSize that fits in a byte
  // This is used for rejection sampling to eliminate modulo bias
  const maxValidValue = Math.floor(256 / alphabetSize) * alphabetSize

  let result = ''

  while (result.length < length) {
    // Generate more random bytes than needed to account for rejections
    const needed = length - result.length
    const bufferSize = Math.ceil(needed * 1.5) // 50% extra for rejections
    const randomBytes = new Uint8Array(bufferSize)
    crypto.getRandomValues(randomBytes)

    for (let i = 0; i < randomBytes.length && result.length < length; i++) {
      // Rejection sampling: only use values that don't introduce bias
      if (randomBytes[i] < maxValidValue) {
        result += alphabet[randomBytes[i] % alphabetSize]
      }
    }
  }

  return result
}

/**
 * Generate a cryptographically secure random hex string.
 *
 * @param length - Desired length of the output string (in hex characters)
 * @returns Cryptographically secure hex string
 */
export function generateSecureRandomHex(length: number): string {
  return generateSecureRandomString(length, RANDOM_CONSTANTS.HEX_ALPHABET)
}

/**
 * Generate cryptographically secure random bytes.
 *
 * @param length - Number of bytes to generate
 * @returns Uint8Array of random bytes
 */
export function generateSecureRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}
