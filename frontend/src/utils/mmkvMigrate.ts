/* mmkvMigrate.ts — V344
 * One-time migration from AsyncStorage (SQLite) to MMKV.
 *
 * Called from app startup (recommended: at the top of app/_layout.tsx before
 * the first render) via `await ensureMMKVMigrated()`. Idempotent — after the
 * first successful run, subsequent calls short-circuit in ~1 ms via a marker
 * key in MMKV.
 *
 * On success:
 *   - All existing AsyncStorage keys copied into the MMKV `privastream-v1`
 *     instance (identical key names).
 *   - AsyncStorage is cleared, freeing the SQLite DB (banishing SQLITE_FULL).
 *   - A marker `@v344:mmkv_migrated_v1 = 'done'` is written to MMKV.
 *
 * Failure mode: any error during migration is logged but never thrown. The
 * app continues to boot; worst case is some keys don't migrate and get
 * re-created on first use (login, settings, etc.). No data loss risk beyond
 * ephemeral caches.
 *
 * File placement: frontend/src/utils/mmkvMigrate.ts
 */
import AsyncStorageOriginal from '@react-native-async-storage/async-storage';
import { rawMMKV } from './mmkvStorage';

const MIGRATION_KEY = '@v344:mmkv_migrated_v1';

let _migrationPromise: Promise<{ migrated: number; skipped: number; failed: number }> | null = null;

export async function ensureMMKVMigrated(): Promise<{ migrated: number; skipped: number; failed: number }> {
  // V361_MMKV_KILL - native module was rolled back; never run migration.
  return { migrated: 0, skipped: 0, failed: 0 };
  if (_migrationPromise) return _migrationPromise;
  _migrationPromise = _run();
  return _migrationPromise;
}

async function _run(): Promise<{ migrated: number; skipped: number; failed: number }> {
  // V360_MMKV_SHORT_CIRCUIT - MMKV native module was rolled back. Every call to
  // rawMMKV.* throws "undefined is not a function", causing this migration to
  // spam 20+ bridge calls per cold boot. Short-circuit immediately.
  try {
    if (typeof (rawMMKV as any)?.getString !== 'function') {
      return { migrated: 0, skipped: 0, failed: 0 };
    }
  } catch (_) {
    return { migrated: 0, skipped: 0, failed: 0 };
  }
  // Fast path: already migrated.
  try {
    if (rawMMKV.getString(MIGRATION_KEY) === 'done') {
      console.log('[V344 mmkv] migration already complete (skip)');
      return { migrated: 0, skipped: 0, failed: 0 };
    }
  } catch {
    /* fall through */
  }

  console.log('[V344 mmkv] starting AsyncStorage -> MMKV migration');
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const keys = await AsyncStorageOriginal.getAllKeys();
    console.log('[V344 mmkv] found', keys.length, 'AsyncStorage keys to migrate');

    for (const key of keys) {
      try {
        const val = await AsyncStorageOriginal.getItem(key);
        if (val === null) {
          skipped++;
          continue;
        }
        rawMMKV.set(key, val);
        migrated++;
      } catch (e: any) {
        failed++;
        console.log('[V344 mmkv] key failed:', key, e?.message || String(e));
      }
    }

    // Mark migration complete in MMKV FIRST — so if the AsyncStorage.clear()
    // below fails we still don't re-run the migration on next boot.
    rawMMKV.set(MIGRATION_KEY, 'done');

    // Clear AsyncStorage to free the SQLite DB.
    try {
      await AsyncStorageOriginal.clear();
      console.log('[V344 mmkv] AsyncStorage cleared - SQLite DB freed');
    } catch (e: any) {
      console.log('[V344 mmkv] AsyncStorage.clear() failed (non-fatal):', e?.message || String(e));
    }

    console.log('[V344 mmkv] migration complete: migrated=' + migrated + ' skipped=' + skipped + ' failed=' + failed);
  } catch (e: any) {
    console.log('[V344 mmkv] migration outer error (non-fatal):', e?.message || String(e));
  }

  return { migrated, skipped, failed };
}

/**
 * Force-reruns the migration on demand (debug/settings screen only).
 * Clears the marker key first so ensureMMKVMigrated() does real work.
 */
export async function forceReMigrate(): Promise<void> {
  try {
    rawMMKV.delete(MIGRATION_KEY);
  } catch {
    /* ignore */
  }
  _migrationPromise = null;
  await ensureMMKVMigrated();
}
