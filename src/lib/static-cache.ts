// In-process cache for static reference data that rarely changes (upload purposes ...).
// A value is read from the DB on first use, kept here, and dropped when an admin clears the cache.
// It lives in one process: with several API instances, clear the cache on each of them.

export const CACHE_KEYS = {
  UPLOAD_PURPOSES: 'UPLOAD_PURPOSES',
  LOOKUPS: 'LOOKUPS',
} as const;
export type CacheKey = (typeof CACHE_KEYS)[keyof typeof CACHE_KEYS];

const store = new Map<string, Promise<unknown>>();

export const isCacheKey = (key: string): key is CacheKey => Object.values<string>(CACHE_KEYS).includes(key);

export const cached = <T>(key: CacheKey, load: () => Promise<T>): Promise<T> => {
  const hit = store.get(key);
  if (hit) return hit as Promise<T>;
  const pending = load();
  store.set(key, pending);
  // a failed load is not kept, the next call asks the DB again
  pending.catch(() => {
    if (store.get(key) === pending) store.delete(key);
  });
  return pending;
};

// Clears one key, or everything when no key is given. Returns the keys that were cleared.
export const clearCache = (key?: CacheKey): string[] => {
  const keys = key ? [key] : Object.values<string>(CACHE_KEYS);
  keys.forEach((k) => store.delete(k));
  return keys;
};
