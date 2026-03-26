/**
 * Security constants for timing protection
 */
export const TIMING_CONSTANTS = {
  /** Maximum jitter in milliseconds */
  MAX_JITTER_MS: 50,
  /** Default jitter range */
  DEFAULT_JITTER_MS: 50,
} as const

/**
 * Add random timing jitter to prevent timing-based side-channel attacks.
 * This makes it harder for attackers to measure response times accurately.
 *
 * @param maxJitterMs - Maximum jitter in milliseconds (default: 50)
 */
export async function addTimingJitter(maxJitterMs: number = TIMING_CONSTANTS.DEFAULT_JITTER_MS): Promise<void> {
  const jitter = crypto.getRandomValues(new Uint8Array(1))[0] % maxJitterMs
  await new Promise(resolve => setTimeout(resolve, jitter))
}

/**
 * Execute a function with timing jitter added before and after.
 * This provides additional protection against timing attacks.
 *
 * @param fn - Function to execute
 * @param maxJitterMs - Maximum jitter in milliseconds
 * @returns Result of the function
 */
export async function withTimingJitter<T>(
  fn: () => T | Promise<T>,
  maxJitterMs: number = TIMING_CONSTANTS.DEFAULT_JITTER_MS
): Promise<T> {
  await addTimingJitter(maxJitterMs)
  const result = await fn()
  await addTimingJitter(maxJitterMs)
  return result
}
