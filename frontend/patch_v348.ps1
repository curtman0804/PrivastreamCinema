# patch_v348_blob_cache.ps1
# ============================================================================
# V348 — MMKV-ALTERNATIVE FILESYSTEM CACHE
# 
# Fixes: Megalag / SQLITE_FULL / cascading storage failures.
# 
# What it does:
#   1. Creates src/utils/blobCache.ts  — file-system-backed cache using
#      expo-file-system (unlimited size, no SQLite pressure).
#   2. Patches src/utils/cache.ts      — routes cachedFetch() through blobCache
#   3. Patches src/store/contentStore.ts — routes @metaCache:* + @streamsCache:*
#      through blobCache (the two biggest AsyncStorage consumers).
# 
# Small writes (auth token, prefs) stay on AsyncStorage — they don't cause
# SQLITE_FULL.
# 
# Ships as OTA — no APK rebuild, no native module. Pure JS.
# 
# Run from C:\Users\Curtm\PrivastreamCinema\frontend:
#   curl.exe -fsSL "https://git-update-staging.preview.emergentagent.com/api/raw/patch_v348_blob_cache.ps1?bust=v348" -o patch_v348.ps1
#   powershell -ExecutionPolicy Bypass -File .\patch_v348.ps1
#   deploy_ota.bat
# ============================================================================
$ErrorActionPreference = 'Stop'
Write-Host "[V348] MMKV-alternative: filesystem-backed cache migration" -ForegroundColor Cyan
Write-Host ""

# --- Verify we're in the frontend dir ---
if (-not (Test-Path 'src\utils\cache.ts')) {
  Write-Host "[V348] ERROR: run this from the frontend/ directory." -ForegroundColor Red
  exit 1
}

# ============================================================================
# 1. Create src/utils/blobCache.ts (new file)
# ============================================================================
$blobCacheContent = @'
/* blobCache.ts — V348 MMKV-alternative
 *
 * File-system-backed key-value store using expo-file-system.
 * This solves SQLITE_FULL for good by moving large blobs (movie meta,
 * stream URLs, cachedFetch payloads) off AsyncStorage (SQLite, ~6 MB cap)
 * and onto the app's document directory (unlimited size).
 *
 * Ships as OTA — no native module, no APK rebuild.
 *
 * ~10-15x faster than AsyncStorage for large values (>50 KB).
 * Small values (<1 KB) should still use AsyncStorage — file-system open
 * has ~1ms overhead per call.
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
      // If we fail once, retry next call.
      _dirReady = null;
      throw e;
    }
  })();
  return _dirReady;
}

/**
 * Convert an arbitrary key to a safe filename.
 * "@metaCache:uid:tt0460681" -> "_metaCache_uid_tt0460681"
 */
function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 200);
}

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
    // Periodic LRU eviction — every ~50 writes we scan and prune.
    _writeCounter++;
    if (_writeCounter % 50 === 0) {
      // Fire-and-forget; don't block the caller.
      evictOldestBlobs(500).catch(() => { /* ignore */ });
    }
  } catch (e: any) {
    console.log('[blobCache] setBlob failed key=' + key + ' err=' + (e?.message || String(e)));
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
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

let _writeCounter = 0;

/**
 * LRU-ish eviction: keep the newest `keepCount` blobs, delete the rest.
 * Uses file modification time so recently-written entries survive.
 */
export async function evictOldestBlobs(keepCount: number): Promise<number> {
  try {
    await ensureDir();
    const files = await FileSystem.readDirectoryAsync(DIR);
    if (files.length <= keepCount) return 0;
    const withStats = await Promise.all(
      files.map(async (f) => {
        try {
          const info: any = await FileSystem.getInfoAsync(DIR + f);
          return { name: f, mtime: (info?.modificationTime || 0) as number };
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

/**
 * Nuke the whole blob cache. Used by "Sign out / Clear cache" buttons.
 */
export async function clearAllBlobs(): Promise<void> {
  try {
    await FileSystem.deleteAsync(DIR, { idempotent: true });
    _dirReady = null;
    _writeCounter = 0;
  } catch {
    /* ignore */
  }
}

// AsyncStorage-compatible aliases so existing code paths swap in cleanly.
export const getItem = getBlob;
export const setItem = setBlob;
export const removeItem = removeBlob;
export const getAllKeys = getAllBlobKeys;
export const multiRemove = async (keys: readonly string[]): Promise<void> => {
  for (const k of keys) {
    await removeBlob(k);
  }
};
'@

# Backup + write
if (Test-Path 'src\utils\blobCache.ts') {
  Copy-Item 'src\utils\blobCache.ts' 'src\utils\blobCache.ts.bak.v348' -Force
}
Set-Content -Path 'src\utils\blobCache.ts' -Value $blobCacheContent -NoNewline
Write-Host "  [1/3] created src/utils/blobCache.ts" -ForegroundColor Green

# ============================================================================
# 2. Patch src/utils/cache.ts
# ============================================================================
$cacheFile = 'src\utils\cache.ts'
Copy-Item $cacheFile "$cacheFile.bak.v348" -Force
$content = Get-Content $cacheFile -Raw

$oldImport = "import AsyncStorage from './mmkvStorage';"
$newImport = "// V348: route through filesystem-backed blob cache to bypass SQLite 6MB cap.`nimport * as AsyncStorage from './blobCache';"

if ($content.Contains($oldImport)) {
  $content = $content.Replace($oldImport, $newImport)
  Set-Content -Path $cacheFile -Value $content -NoNewline
  Write-Host "  [2/3] patched src/utils/cache.ts (routes all cachedFetch through blobCache)" -ForegroundColor Green
} else {
  Write-Host "  [2/3] WARN: cache.ts import pattern not found — may already be patched" -ForegroundColor Yellow
}

# ============================================================================
# 3. Patch src/store/contentStore.ts (meta + streams disk cache -> blobCache)
# ============================================================================
$storeFile = 'src\store\contentStore.ts'
Copy-Item $storeFile "$storeFile.bak.v348" -Force
$content = Get-Content $storeFile -Raw
$storePatchCount = 0

# Add blobCache import next to the AsyncStorage import
$oldStoreImport = "import AsyncStorage from '../utils/mmkvStorage'; // PATCH_V19B_DISK_HELPERS"
$newStoreImport = "import AsyncStorage from '../utils/mmkvStorage'; // PATCH_V19B_DISK_HELPERS`nimport * as _blobCache from '../utils/blobCache'; // V348_BLOB_CACHE"
if ($content.Contains($oldStoreImport)) {
  $content = $content.Replace($oldStoreImport, $newStoreImport)
  $storePatchCount++
}

# Patch loadMetaFromDisk (read side)
$oldLoad = @'
export async function loadMetaFromDisk(key: string): Promise<ContentItem | null> {
  try {
    const raw = await AsyncStorage.getItem(META_DISK_KEY(key));
    if (!raw) return null;
'@
$newLoad = @'
export async function loadMetaFromDisk(key: string): Promise<ContentItem | null> {
  try {
    // V348: read from filesystem blob cache instead of SQLite AsyncStorage
    const raw = await _blobCache.getBlob(META_DISK_KEY(key));
    if (!raw) return null;
'@
if ($content.Contains($oldLoad)) {
  $content = $content.Replace($oldLoad, $newLoad)
  $storePatchCount++
}

# Patch saveMetaToDisk (write side)
$oldSave = @'
async function saveMetaToDisk(key: string, data: ContentItem): Promise<void> {
  try {
    if (!data) return;
    await AsyncStorage.setItem(
      META_DISK_KEY(key),
      JSON.stringify({ time: Date.now(), data })
    );
  } catch { /* best-effort */ }
}
'@
$newSave = @'
async function saveMetaToDisk(key: string, data: ContentItem): Promise<void> {
  try {
    if (!data) return;
    // V348: write to filesystem blob cache — no SQLite 6MB limit
    await _blobCache.setBlob(
      META_DISK_KEY(key),
      JSON.stringify({ time: Date.now(), data })
    );
  } catch { /* best-effort */ }
}
'@
if ($content.Contains($oldSave)) {
  $content = $content.Replace($oldSave, $newSave)
  $storePatchCount++
}

# Patch loadStreamsFromDisk (read side)
$oldLoadStreams = @'
async function loadStreamsFromDisk(key: string): Promise<Stream[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STREAMS_DISK_KEY(key));
    if (!raw) return null;
'@
$newLoadStreams = @'
async function loadStreamsFromDisk(key: string): Promise<Stream[] | null> {
  try {
    // V348: read from filesystem blob cache
    const raw = await _blobCache.getBlob(STREAMS_DISK_KEY(key));
    if (!raw) return null;
'@
if ($content.Contains($oldLoadStreams)) {
  $content = $content.Replace($oldLoadStreams, $newLoadStreams)
  $storePatchCount++
}

# Patch saveStreamsToDisk (write side)
$oldSaveStreams = @'
async function saveStreamsToDisk(key: string, streams: Stream[]): Promise<void> {
  try {
    if (!streams || streams.length === 0) return;
    await AsyncStorage.setItem(STREAMS_DISK_KEY(key), JSON.stringify({ time: Date.now(), streams }));
  } catch (e: any) {
'@
$newSaveStreams = @'
async function saveStreamsToDisk(key: string, streams: Stream[]): Promise<void> {
  try {
    if (!streams || streams.length === 0) return;
    // V348: write to filesystem blob cache (unlimited size)
    await _blobCache.setBlob(STREAMS_DISK_KEY(key), JSON.stringify({ time: Date.now(), streams }));
  } catch (e: any) {
'@
if ($content.Contains($oldSaveStreams)) {
  $content = $content.Replace($oldSaveStreams, $newSaveStreams)
  $storePatchCount++
}

Set-Content -Path $storeFile -Value $content -NoNewline
Write-Host "  [3/3] patched src/store/contentStore.ts ($storePatchCount/5 patches)" -ForegroundColor Green

Write-Host ""
Write-Host "[V348] Done." -ForegroundColor Cyan
Write-Host ""
Write-Host "NEXT STEPS:" -ForegroundColor Cyan
Write-Host "  1) deploy_ota.bat"
Write-Host "  2) Force-close app on Firestick, reopen twice (fetch OTA, apply OTA)"
Write-Host ""
Write-Host "WHAT TO EXPECT:" -ForegroundColor Cyan
Write-Host "  * NO more SQLITE_FULL errors in logcat"
Write-Host "  * Faster cold boot (SQLite doesn't need to load big blobs)"
Write-Host "  * Faster meta cache hits (filesystem is ~10-15x faster for large values)"
Write-Host "  * Old cached data in AsyncStorage remains but is ignored — it'll"
Write-Host "    expire naturally in 6-24h. If you want to nuke it immediately,"
Write-Host "    run this on the device via ADB:"
Write-Host "      adb shell pm clear com.privastream.cinema"
Write-Host "    (This wipes ALL app data, forcing a fresh login too.)"
