/**
 * In-memory cache with TTL (Time-To-Live) support.
 * Modeled after the missav-api Cache class.
 */

import type { CacheEntry } from './types';
import { DEFAULT_CACHE_TTL } from './constants';

export class Cache {
  private store: Map<string, CacheEntry<unknown>>;
  private defaultTtl: number;

  constructor(defaultTtl: number = DEFAULT_CACHE_TTL) {
    this.store = new Map();
    this.defaultTtl = defaultTtl;
  }

  /** Get a value from cache. Returns undefined if expired or missing. */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    // Lazy expiration: delete expired entries on read
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }

    return entry.value as T;
  }

  /** Set a value in cache with optional custom TTL */
  set<T>(key: string, value: T, ttl?: number): void {
    const effectiveTtl = ttl ?? this.defaultTtl;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + effectiveTtl,
    });
  }

  /** Check if a valid (non-expired) entry exists */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  /** Delete a specific entry */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Clear all cache entries */
  clear(): void {
    this.store.clear();
  }

  /** Number of entries in cache (including expired, until lazy cleanup) */
  get size(): number {
    return this.store.size;
  }
}
