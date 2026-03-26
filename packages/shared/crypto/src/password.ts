// Password hashing utilities for user management
// Security hardened for post-quantum computing resistance
import * as bcrypt from 'bcryptjs'

/**
 * Security constants for password handling
 */
export const PASSWORD_CONSTANTS = {
  // Minimum bcrypt rounds for post-quantum security
  // Higher rounds = more computational cost for attackers
  MIN_ROUNDS: 12,
  // Maximum password length to prevent DoS attacks
  // bcrypt has a 72-byte limit anyway, but we add extra protection
  MAX_PASSWORD_LENGTH: 1024,
  // Recommended rounds for high-security applications
  RECOMMENDED_ROUNDS: 14,
  // Dummy hash for constant-time operations when validation fails
  DUMMY_HASH: '$2a$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
} as const

/**
 * Validate password input before processing
 * @param password - Password to validate
 * @returns true if password is valid for processing
 */
function isValidPasswordInput(password: unknown): password is string {
  return (
    typeof password === 'string' &&
    password.length > 0 &&
    password.length <= PASSWORD_CONSTANTS.MAX_PASSWORD_LENGTH
  )
}

/**
 * Hash a password using bcrypt with post-quantum secure defaults.
 *
 * Security considerations:
 * - Uses minimum 12 rounds (2^12 iterations) for quantum resistance
 * - Validates input length to prevent DoS attacks
 * - bcrypt's 72-byte limit provides natural protection against very long passwords
 *
 * Note: While bcrypt is not quantum-resistant in the cryptographic sense,
 * its computational cost makes brute-force attacks expensive even with
 * quantum speedups (Grover's algorithm provides only quadratic speedup
 * for symmetric operations).
 *
 * @param password - Plain text password to hash
 * @param rounds - Number of salt rounds (default: 12, minimum: 12)
 * @returns Promise resolving to the hashed password
 * @throws Error if password is invalid
 */
export async function hashPassword(password: string, rounds: number = PASSWORD_CONSTANTS.MIN_ROUNDS): Promise<string> {
  // Validate password input
  if (!isValidPasswordInput(password)) {
    throw new Error('Invalid password: must be a non-empty string with maximum 1024 characters')
  }

  // Enforce minimum rounds for security
  const secureRounds = Math.max(rounds, PASSWORD_CONSTANTS.MIN_ROUNDS)

  return await bcrypt.hash(password, secureRounds)
}

/**
 * Verify a password against a hash with timing attack protection.
 *
 * Security considerations:
 * - Always performs a comparison operation to maintain constant time
 * - Validates inputs before processing
 * - Uses dummy hash comparison when inputs are invalid to prevent timing leaks
 *
 * @param password - Plain text password to verify
 * @param hash - Hashed password to compare against
 * @returns Promise resolving to true if password matches, false otherwise
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  // Validate password input - always perform comparison to maintain constant time
  if (!isValidPasswordInput(password)) {
    // Perform dummy comparison to prevent timing attacks
    await bcrypt.compare('dummy-password-for-timing', PASSWORD_CONSTANTS.DUMMY_HASH)
    return false
  }

  // Validate hash format (bcrypt hashes start with $2)
  if (typeof hash !== 'string' || !hash.startsWith('$2')) {
    // Perform dummy comparison to prevent timing attacks
    await bcrypt.compare(password, PASSWORD_CONSTANTS.DUMMY_HASH)
    return false
  }

  // bcrypt.compare is designed to be constant-time
  return await bcrypt.compare(password, hash)
}

/**
 * Check if a password hash needs to be upgraded to more secure parameters.
 *
 * This is useful for gradually upgrading password security as users log in.
 *
 * @param hash - The bcrypt hash to check
 * @param targetRounds - Target number of rounds (default: MIN_ROUNDS)
 * @returns true if the hash should be upgraded
 */
export function needsRehash(hash: string, targetRounds: number = PASSWORD_CONSTANTS.MIN_ROUNDS): boolean {
  if (typeof hash !== 'string' || !hash.startsWith('$2')) {
    return true
  }

  // Extract rounds from bcrypt hash (format: $2a$XX$...)
  const roundsMatch = hash.match(/^\$2[aby]?\$(\d{2})\$/)
  if (!roundsMatch) {
    return true
  }

  const currentRounds = parseInt(roundsMatch[1], 10)
  return currentRounds < targetRounds
}
