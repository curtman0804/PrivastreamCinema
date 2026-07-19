/* blobCache.ts — V348 MMKV-alternative
 *
 * File-system-backed key-value store using expo-file-system.
 * Solves SQLITE_FULL by moving large blobs (movie meta, stream URLs)
 * off AsyncStorage (SQLite, ~6 MB cap) onto the app's document
 * directory (unlimited size).
 *
 * Ships as OTA - no native module, no APK rebuild.
 * ~10-15x faster than AsyncStorage for large values (>50 KB).
 */
import * as FileSystem from 'expo-file-system';

const DIR = (FileSystem.documentDirectory || '') + 'blob-cache/';

let _dirReady: Promise<void> | null = null;
function ensureDir(): Promise<void> {
  if (_dirReady) return _dirReady;
  _dirReady = (async () => {
    try {
      const info = await FileSystem.getInfoAsync(DIR);
      if (!info.exists) {
        await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
      }
    } catch (e) {
      _dirReady = null;
      throw e;
    }
  })();
  return _dirReady;
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
}

let _writeCounter = 0;

export async function getBlob(key: string): Promise<string | null> {
  try {
    await ensureDir();
    const path = DIR + safeKey(key) + '.json';
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(path);
  } catch {
    return null;
  }
}

export async function setBlob(key: string, value: string): Promise<void> {
  try {
    await ensureDir();
    const path = DIR + safeKey(key) + '.json';
    await FileSystem.writeAsStringAsync(path, value);
    _writeCounter++;
    if (_writeCounter % 50 === 0) {
      evictOldestBlobs(500).catch(() => { /* ignore */ });
    }
  } catch (e: any) {
    console.log('[blobCache] setBlob failed key=' + key + ' err=' + (e && e.message ? e.message : String(e)));
  }
}

export async function removeBlob(key: string): Promise<void> {
  try {
    await ensureDir();
    const path = DIR + safeKey(key) + '.json';
    await FileSystem.deleteAsync(path, { idempotent: true });
  } catch {
    /* ignore */
  }
}

export async function getAllBlobKeys(): Promise<string[]> {
  try {
    await ensureDir();
    const files = await FileSystem.readDirectoryAsync(DIR);
    return files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

export async function evictOldestBlobs(keepCount: number): Promise<number> {
  try {
    await ensureDir();
    const files = await FileSystem.readDirectoryAsync(DIR);
    if (files.length <= keepCount) return 0;
    const withStats = await Promise.all(
      files.map(async (f) => {
        try {
          const info: any = await FileSystem.getInfoAsync(DIR + f);
          return { name: f, mtime: (info && info.modificationTime) || 0 };
        } catch {
          return { name: f, mtime: 0 };
        }
      })
    );
    withStats.sort((a, b) => a.mtime - b.mtime);
    const toDelete = withStats.slice(0, files.length - keepCount);
    for (const { name } of toDelete) {
      try {
        await FileSystem.deleteAsync(DIR + name, { idempotent: true });
      } catch {
        /* ignore */
      }
    }
    console.log('[blobCache] evicted ' + toDelete.length + ' old blobs, kept ' + keepCount);
    return toDelete.length;
  } catch {
    return 0;
  }
}

export async function clearAllBlobs(): Promise<void> {
  try {
    await FileSystem.deleteAsync(DIR, { idempotent: true });
    _dirReady = null;
    _writeCounter = 0;
  } catch {
    /* ignore */
  }
}

// AsyncStorage-compatible aliases
export const getItem = getBlob;
export const setItem = setBlob;
export const removeItem = removeBlob;
export const getAllKeys = getAllBlobKeys;
export const multiRemove = async (keys: readonly string[]): Promise<void> => {
  for (const k of keys) {
    await removeBlob(k);
  }
};
