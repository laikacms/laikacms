/**
 * Cache entry with optional expiration
 */
export interface CacheEntry<T> {
  value: T;
  expiresAt?: Date;
}

/**
 * Async key-value cache interface with expiration support
 * 
 * Similar to Map but async and with TTL (time-to-live) support.
 * 
 * @example
 * ```typescript
 * const cache: AsyncCache<string, User> = new MemoryCache();
 * 
 * // Set with expiration (5 minutes)
 * await cache.set('user:123', user, new Date(Date.now() + 5 * 60 * 1000));
 * 
 * // Get value (returns undefined if expired)
 * const user = await cache.get('user:123');
 * 
 * // Check if key exists and not expired
 * const exists = await cache.has('user:123');
 * 
 * // Delete entry
 * await cache.delete('user:123');
 * 
 * // Clear all entries
 * await cache.clear();
 * ```
 */
export interface AsyncCache<K, V> {
  /**
   * Get a value from the cache
   * Returns undefined if the key doesn't exist or has expired
   */
  get(key: K): Promise<V | undefined>;

  /**
   * Set a value in the cache with optional expiration
   * @param key - The cache key
   * @param value - The value to cache
   * @param expiresAt - Optional expiration date. If not provided, the entry never expires
   */
  set(key: K, value: V, expiresAt?: Date): Promise<void>;

  /**
   * Check if a key exists in the cache and has not expired
   */
  has(key: K): Promise<boolean>;

  /**
   * Delete a key from the cache
   * @returns true if the key existed and was deleted, false otherwise
   */
  delete(key: K): Promise<boolean>;

  /**
   * Clear all entries from the cache
   */
  clear(): Promise<void>;

  /**
   * Get the number of entries in the cache (including expired ones)
   * Note: Some implementations may exclude expired entries
   */
  size(): Promise<number>;

  /**
   * Get all keys in the cache (excluding expired ones)
   */
  keys(): Promise<K[]>;

  /**
   * Get all values in the cache (excluding expired ones)
   */
  values(): Promise<V[]>;

  /**
   * Get all entries in the cache (excluding expired ones)
   */
  entries(): Promise<Array<[K, V]>>;

  /**
   * Iterate over all entries in the cache (excluding expired ones)
   */
  forEach(callback: (value: V, key: K) => void | Promise<void>): Promise<void>;
}

/**
 * Simple in-memory implementation of AsyncCache
 * Useful for testing or simple use cases
 */
export class MemoryCache<K, V> implements AsyncCache<K, V> {
  private cache = new Map<K, CacheEntry<V>>();

  async get(key: K): Promise<V | undefined> {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (entry.expiresAt && entry.expiresAt < new Date()) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  async set(key: K, value: V, expiresAt?: Date): Promise<void> {
    this.cache.set(key, { value, expiresAt });
  }

  async has(key: K): Promise<boolean> {
    const value = await this.get(key);
    return value !== undefined;
  }

  async delete(key: K): Promise<boolean> {
    return this.cache.delete(key);
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async size(): Promise<number> {
    // Clean up expired entries first
    await this.cleanExpired();
    return this.cache.size;
  }

  async keys(): Promise<K[]> {
    await this.cleanExpired();
    return Array.from(this.cache.keys());
  }

  async values(): Promise<V[]> {
    await this.cleanExpired();
    return Array.from(this.cache.values()).map(entry => entry.value);
  }

  async entries(): Promise<Array<[K, V]>> {
    await this.cleanExpired();
    return Array.from(this.cache.entries()).map(([key, entry]) => [key, entry.value]);
  }

  async forEach(callback: (value: V, key: K) => void | Promise<void>): Promise<void> {
    await this.cleanExpired();
    for (const [key, entry] of this.cache.entries()) {
      await callback(entry.value, key);
    }
  }

  /**
   * Remove all expired entries from the cache
   */
  private async cleanExpired(): Promise<void> {
    const now = new Date();
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt && entry.expiresAt < now) {
        this.cache.delete(key);
      }
    }
  }
}