/**
 * In-memory cache with use-count decay and optional TTL.
 * Entries are evicted after N reads (maxUses) or when maxAgeMs is exceeded.
 * Supports explicit invalidation by key or by key prefix.
 * Optional maxEntries for bounded memory (LRU eviction).
 */

export interface CacheSetOptions {
  /** After this many get() calls, the entry is removed. Next get() misses and caller can recompute. */
  maxUses?: number;
  /** Entry is considered stale after this many ms. Default: no TTL. */
  maxAgeMs?: number;
}

interface CacheEntry<T> {
  value: T;
  useCount: number;
  createdAt: number;
  maxUses: number;
  maxAgeMs: number | undefined;
}

export interface CacheOptions {
  /** Maximum number of entries. When exceeded, least recently used entry is evicted. */
  maxEntries?: number;
}

/**
 * Generic cache with use-count decay and optional TTL.
 * Safe for single-process (Node/Bun) event loop.
 */
export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private accessOrder: string[] = []; // LRU: oldest at front, newest at back
  private readonly maxEntries: number | undefined;

  constructor(options: CacheOptions = {}) {
    this.maxEntries = options.maxEntries;
  }

  /**
   * Get a value. Increments use count. If use count reaches maxUses or entry is older than maxAgeMs,
   * the entry is removed and undefined is returned (caller should recompute and set).
   */
  get<T>(key: string, options?: { maxUses?: number; maxAgeMs?: number }): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;

    const now = Date.now();
    const maxAgeMs = entry.maxAgeMs ?? options?.maxAgeMs;
    if (maxAgeMs !== undefined && now - entry.createdAt >= maxAgeMs) {
      this.deleteKey(key);
      return undefined;
    }

    entry.useCount++;
    const maxUses = entry.maxUses ?? options?.maxUses ?? Infinity;
    if (entry.useCount >= maxUses) {
      this.deleteKey(key);
      return undefined;
    }

    this.touch(key);
    return entry.value as T;
  }

  /**
   * Store a value with optional decay options. If maxEntries is set and cache is full, evicts LRU entry.
   */
  set<T>(key: string, value: T, setOptions: CacheSetOptions = {}): void {
    const maxUses = setOptions.maxUses ?? 10;
    const maxAgeMs = setOptions.maxAgeMs;

    if (this.maxEntries !== undefined && this.store.size >= this.maxEntries && !this.store.has(key)) {
      this.evictLRU();
    }

    const entry: CacheEntry<T> = {
      value,
      useCount: 0,
      createdAt: Date.now(),
      maxUses,
      maxAgeMs,
    };
    this.store.set(key, entry);
    this.touch(key);
  }

  /**
   * Remove a single key.
   */
  invalidate(key: string): void {
    this.deleteKey(key);
  }

  /**
   * Remove all keys that start with the given prefix.
   */
  invalidatePattern(prefix: string): void {
    const toDelete: string[] = [];
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) toDelete.push(key);
    }
    for (const key of toDelete) this.deleteKey(key);
  }

  /**
   * Check if key exists (without incrementing use count or triggering decay).
   */
  has(key: string): boolean {
    return this.store.has(key);
  }

  /**
   * Number of entries currently in the cache.
   */
  get size(): number {
    return this.store.size;
  }

  private deleteKey(key: string): void {
    this.store.delete(key);
    const i = this.accessOrder.indexOf(key);
    if (i !== -1) this.accessOrder.splice(i, 1);
  }

  /** Move key to end of access order (most recently used). */
  private touch(key: string): void {
    const i = this.accessOrder.indexOf(key);
    if (i !== -1) this.accessOrder.splice(i, 1);
    this.accessOrder.push(key);
  }

  private evictLRU(): void {
    const key = this.accessOrder.shift();
    if (key) this.store.delete(key);
  }
}

/** Default shared instance for prompt and ontology use. Callers can also create their own Cache. */
let defaultCache: Cache | null = null;

/**
 * Get the default cache instance (lazy-created with maxEntries 500).
 */
export function getDefaultCache(): Cache {
  if (!defaultCache) {
    defaultCache = new Cache({ maxEntries: 500 });
  }
  return defaultCache;
}

/**
 * Reset the default cache (e.g. for tests).
 */
export function resetDefaultCache(): void {
  defaultCache = null;
}
