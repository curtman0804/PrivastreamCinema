import AsyncStorage from '@react-native-async-storage/async-storage';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

// Cache durations in milliseconds
export const CACHE_DURATIONS = {
  SHORT: 5 * 60 * 1000,      // 5 minutes - for frequently changing data
  MEDIUM: 30 * 60 * 1000,    // 30 minutes - for catalog data
  LONG: 2 * 60 * 60 * 1000,  // 2 hours - for metadata
  VERY_LONG: 24 * 60 * 60 * 1000, // 24 hours - for static content
};

// In-memory cache for fast access
const memoryCache = new Map<string, CacheEntry<any>>();

/**
 * Get data from cache (memory first, then AsyncStorage)
 */
export async function getCached<T>(key: string): Promise<T | null> {
  // Check memory cache first
  const memEntry = memoryCache.get(key);
  if (memEntry && Date.now() < memEntry.expiresAt) {
    return memEntry.data;
  }
  
  // Check AsyncStorage
  try {
    const stored = await AsyncStorage.getItem(`cache_${key}`);
    if (stored) {
      const entry: CacheEntry<T> = JSON.parse(stored);
      if (Date.now() < entry.expiresAt) {
        // Update memory cache
        memoryCache.set(key, entry);
        return entry.data;
      } else {
        // Expired - remove from storage
        await AsyncStorage.removeItem(`cache_${key}`);
      }
    }
  } catch (e) {
    console.log('[Cache] Error reading cache:', e);
  }
  
  return null;
}

/**
 * Set data in cache (both memory and AsyncStorage)
 */
export async function setCache<T>(key: string, data: T, duration: number = CACHE_DURATIONS.MEDIUM): Promise<void> {
  const entry: CacheEntry<T> = {
    data,
    timestamp: Date.now(),
    expiresAt: Date.now() + duration,
  };
  
  // Set in memory cache
  memoryCache.set(key, entry);
  
  // Set in AsyncStorage (don't await to avoid blocking)
  AsyncStorage.setItem(`cache_${key}`, JSON.stringify(entry)).catch(e => {
    console.log('[Cache] Error writing cache:', e);
  });
}

/**
 * Clear specific cache entry
 */
export async function clearCache(key: string): Promise<void> {
  memoryCache.delete(key);
  await AsyncStorage.removeItem(`cache_${key}`);
}

/**
 * Clear all cache entries
 */
export async function clearAllCache(): Promise<void> {
  memoryCache.clear();
  
  try {
    const keys = await AsyncStorage.getAllKeys();
    const cacheKeys = keys.filter(k => k.startsWith('cache_'));
    await AsyncStorage.multiRemove(cacheKeys);
  } catch (e) {
    console.log('[Cache] Error clearing cache:', e);
  }
}

/**
 * Wrapper for API calls with caching
 */
export async function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  duration: number = CACHE_DURATIONS.MEDIUM
): Promise<T> {
  // Try to get from cache first
  const cached = await getCached<T>(key);
  if (cached !== null) {
    console.log(`[Cache] Hit: ${key}`);
    return cached;
  }
  
  // Fetch fresh data
  console.log(`[Cache] Miss: ${key}`);
  const data = await fetcher();
  
  // Cache the result
  await setCache(key, data, duration);
  
  return data;
}
