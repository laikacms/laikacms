import { createHash, Hash, randomBytes, timingSafeEqual } from 'crypto';
import bs58 from './bs58.js';

/**
 * DistributionToken - Utilities for managing distribution token secrets
 *
 * ## Purpose
 *
 * Distribution tokens provide read-only access to project content (documents, files, collections)
 * via the Distribution API. They are designed to be embedded in client applications.
 *
 * ## Usage Patterns
 *
 * ### 1. Public Tokens (Embedded in Web Apps)
 * Many users embed distribution tokens directly in their public web applications
 * (e.g., in JavaScript bundles) to allow anyone to read their published content.
 * This is the primary use case - similar to how you might embed a Google Maps API key.
 *
 * Example: A blog that fetches articles from the CMS using a token embedded in the frontend.
 *
 * ### 2. Private Tokens (Internal Use Only)
 * Some users keep their content internal and never expose the token publicly.
 * For these users, we hash the token to provide defense-in-depth protection
 * in case of database compromise.
 *
 * Example: An internal company wiki that only fetches content from backend servers.
 *
 * ## Security Model
 *
 * **Important**: Hashing provides NO security benefit for publicly embedded tokens.
 * If a token is in your JavaScript bundle, anyone can extract and use it.
 *
 * Hashing only helps in the private token scenario:
 * - If the database is compromised, attackers get hashes instead of plaintext tokens
 * - Users who keep tokens private get an extra layer of protection
 * - The hash serves as defense-in-depth, not primary security
 *
 * ## Technical Details
 *
 * - Uses SHA-256 for fast hashing (sufficient given high-entropy random secrets)
 * - 32-byte (256-bit) random secrets provide ~256 bits of entropy
 * - 16-byte (128-bit) random salts prevent rainbow table attacks
 * - Constant-time comparison prevents timing attacks during verification
 *
 * Why SHA-256 instead of KDF (like PBKDF2/bcrypt/scrypt)?
 * - The secret is already high-entropy (32 random bytes = 256 bits)
 * - No need for key stretching when input has maximum entropy
 * - SHA-256 is extremely fast, reducing API latency
 * - Salting prevents rainbow tables, which is the main concern
 *
 * This is the same approach used by GitHub Personal Access Tokens,
 * AWS Access Keys, and other API token systems.
 */
export const distributionTokenCrypto = {
  /**
   * Generate a new distribution token secret with salt and hash
   * 
   * This method:
   * 1. Generates a cryptographically secure 32-byte random secret
   * 2. Generates a 16-byte random salt
   * 3. Hashes the secret with the salt using SHA-256
   * 4. Returns all three values (secret, salt, hash)
   * 
   * The secret should be shown to the user immediately and never stored.
   * Only the salt and hash should be stored in the database.
   * 
   * @returns Object containing the raw secret, salt, and hash
   * 
   * @example
   * ```typescript
   * const secret = DistributionToken.generateSecret();
   * const salt = DistributionToken.generateSalt();
   * const tokenId = DistributionToken.hashSecret(secret, salt);
   * 
   * // Show secret to user (only once!)
   * console.log('Your secret:', secret);
   * 
   * // Store in database
   * await db.tokens.create({
   *   id: '...',
   *   salt: salt,
   *   // ... other fields
   * });
   * ```
   */
  generateSecret(): string {
    // Generate 32 bytes (256 bits) of cryptographically secure random data
    // This provides maximum entropy, making brute force attacks infeasible
    const secretBytes = randomBytes(32);
    const secret = bs58.encode(secretBytes);
    
    return secret;
  },

  generateSalt(): string {
    // Generate 16 bytes (128 bits) of random salt
    // Salt prevents rainbow table attacks and ensures unique hashes
    const saltBytes = randomBytes(16);
    const salt = bs58.encode(saltBytes);

    return salt;
  },

  /**
   * Hash a secret with a salt using SHA-256
   * 
   * This is a deterministic operation that produces the same hash
   * for the same secret and salt combination.
   * 
   * The salt is prepended to the secret before hashing to ensure
   * that the same secret with different salts produces different hashes.
   * 
   * @param secret - The raw secret to hash
   * @param salt - The salt to use for hashing
   * @returns Base64-encoded SHA-256 hash
   * 
   * @example
   * ```typescript
   * const hash = DistributionToken.hashSecret(userProvidedSecret, storedSalt);
   * ```
   */
  createHash(secret: string, salt: string): Hash {
    // Prepend salt to secret and hash with SHA-256
    // Format: SHA256(salt + secret)
    const hash = createHash('sha256')
      .update(bs58.decode(salt))
      .update(bs58.decode(secret))

    return hash;
  },

  hashSecret(secret: string, salt: string): string {
    const hash = this.createHash(secret, salt);
    return bs58.encode(hash.digest());
  },
  
  /**
   * Verify a secret against a stored hash using constant-time comparison
   * 
   * This method:
   * 1. Hashes the provided secret with the stored salt
   * 2. Compares the result with the stored hash using constant-time comparison
   * 3. Returns true if they match, false otherwise
   * 
   * Constant-time comparison prevents timing attacks where an attacker
   * could determine the correct hash by measuring comparison time.
   * 
   * @param secret - The secret to verify
   * @param salt - The salt used when creating the hash
   * @param storedHash - The hash stored in the database
   * @returns True if the secret is valid, false otherwise
   * 
   * @example
   * ```typescript
   * const isValid = DistributionToken.verifySecret(
   *   userProvidedSecret,
   *   token.salt,
   *   token.secretHash
   * );
   * 
   * if (isValid) {
   *   // Grant access
   * } else {
   *   // Deny access
   * }
   * ```
   */
  verifySecret(secret: string, salt: string, storedHash: string): boolean {
    try {
      // Hash the provided secret with the stored salt
      const computedHash = this.createHash(secret, salt).digest(); // Buffer
      
      const storedBuffer = bs58.decode(storedHash);
      
      // Use crypto.timingSafeEqual for constant-time comparison
      // This prevents timing attacks by always taking the same time
      // regardless of where the first difference occurs
      return timingSafeEqual(computedHash, storedBuffer);
    } catch {
      // If any error occurs (invalid base64, etc.), return false
      return false;
    }
  },
}
