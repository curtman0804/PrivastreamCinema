# ============================================================================
# patch_v377.ps1 - MMKV migration, phase 2: real native MMKV engine
#
# PREREQUISITE (run FIRST, in the frontend folder):
#   npx expo install react-native-mmkv react-native-nitro-modules
#
# What this patch does: replaces src\utils\mmkvStorage.ts with a TRI-TIER
# engine:
#   1. react-native-mmkv (native, JSI, ~30x faster)  <- used on the NEW APK
#   2. FS KV store (V376)                            <- fallback on the OLD APK
#   3. legacy SQLite AsyncStorage                    <- read-only migration source
# Reads that miss a tier fall through and migrate the value UP, so sessions,
# PM keys and watch progress carry forward automatically at every step.
#
# SAFE ORDERING: the OTA bundle built after this patch still runs fine on
# your CURRENT APK (MMKV instantiation throws -> caught -> FS engine).  The
# native engine activates the moment you install the rebuilt APK.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL].
# ============================================================================

$ErrorActionPreference = 'Stop'
$Root = 'C:\Users\Curtm\PrivastreamCinema\frontend'
Set-Location $Root

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V377 native MMKV tri-tier engine" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# Guard: the mmkv JS package must be installed or Metro will fail to bundle.
if (!(Test-Path -LiteralPath (Join-Path $Root 'node_modules\react-native-mmkv\package.json'))) {
  Write-Host "[FATAL] react-native-mmkv is not installed. Run first:" -ForegroundColor Red
  Write-Host "        npx expo install react-native-mmkv react-native-nitro-modules" -ForegroundColor Red
  exit 1
}

$shimPath = Join-Path $Root 'src\utils\mmkvStorage.ts'
if (!(Test-Path -LiteralPath $shimPath)) {
  Write-Host "[FATAL] src\utils\mmkvStorage.ts not found (V376 should have created it)" -ForegroundColor Red
  exit 1
}
$cur = [System.IO.File]::ReadAllText($shimPath)
if ($cur.Contains('V377_MMKV_TRI_TIER')) {
  Write-Host "[SKIP] shim already V377" -ForegroundColor Yellow
} else {
  Copy-Item -LiteralPath $shimPath -Destination ($shimPath + '.bak_v377') -Force

$shim = @'
/* mmkvStorage.ts - V377_MMKV_TRI_TIER  (MMKV migration phase 2)
 *
 * AsyncStorage-compatible persistent KV store with three engines:
 *   1. react-native-mmkv (native JSI)  - active when the APK includes it
 *   2. FS KV store (V376)              - fallback on APKs without MMKV
 *   3. legacy SQLite AsyncStorage      - read-only migration source
 * Reads fall through the tiers and migrate values UP, so auth sessions,
 * PM keys and watch progress carry forward automatically.
 */
import * as FileSystem from 'expo-file-system/legacy';
import RealAsyncStorage from '@react-native-async-storage/async-storage';

/* ---- Tier 1: native MMKV (throws + falls back on APKs without it) ---- */
let _mmkv: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { MMKV } = require('react-native-mmkv');
  const inst = new MMKV({ id: 'privastream-kv-v1' });
  inst.set('__v377_probe__', '1');
  inst.delete('__v377_probe__');
  _mmkv = inst;
  console.log('[kvStore] MMKV native engine ACTIVE');
} catch (_e) {
  _mmkv = null;
  console.log('[kvStore] MMKV native unavailable - FS engine active');
}

/* ---- Tier 2: FS KV store (V376) ---- */
const DIR = (FileSystem.documentDirectory || '') + 'kv-store/';
const MEM_CACHE_MAX_VALUE = 262144; // 256 KB

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

function enc(key: string): string {
  return encodeURIComponent(key).replace(/~/g, '%7E').replace(/%/g, '~');
}
function dec(name: string): string {
  try { return decodeURIComponent(name.replace(/~/g, '%')); } catch { return name; }
}

const _mem = new Map<string, string | null>();
const _writeChains = new Map<string, Promise<void>>();

function _chain(key: string, op: () => Promise<void>): Promise<void> {
  const prev = _writeChains.get(key) || Promise.resolve();
  const next = prev.then(op, op);
  _writeChains.set(key, next);
  return next;
}

async function _fsRead(key: string): Promise<string | null> {
  try {
    await ensureDir();
    const path = DIR + enc(key) + '.kv';
    const info = await FileSystem.getInfoAsync(path);
    if (!info.exists) return null;
    return await FileSystem.readAsStringAsync(path);
  } catch {
    return null;
  }
}

async function _fsWrite(key: string, value: string): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.writeAsStringAsync(DIR + enc(key) + '.kv', value);
  } catch (e: any) {
    console.log('[kvStore] write failed key=' + key + ' err=' + (e && e.message ? e.message : String(e)));
  }
}

async function _fsDelete(key: string): Promise<void> {
  try {
    await ensureDir();
    await FileSystem.deleteAsync(DIR + enc(key) + '.kv', { idempotent: true });
  } catch { /* ignore */ }
}

function _memSet(key: string, value: string | null): void {
  if (value !== null && value.length > MEM_CACHE_MAX_VALUE) {
    _mem.delete(key);
  } else {
    _mem.set(key, value);
  }
}

/* ---- AsyncStorage-compatible API over the tiers ---- */
async function getItem(key: string): Promise<string | null> {
  if (_mem.has(key)) return _mem.get(key) ?? null;
  let v: string | null = null;
  if (_mmkv) {
    try {
      const s = _mmkv.getString(key);
      v = s === undefined ? null : s;
    } catch { v = null; }
  }
  if (v === null) {
    v = await _fsRead(key);
    const fromFs = v !== null;
    if (v === null) {
      try { v = await RealAsyncStorage.getItem(key); } catch { v = null; }
    }
    if (v !== null) {
      /* migrate the value UP to the best available tier */
      if (_mmkv) {
        try { _mmkv.set(key, v); } catch { /* ignore */ }
      } else if (!fromFs) {
        const vv = v;
        _chain(key, () => _fsWrite(key, vv));
      }
    }
  }
  _memSet(key, v);
  return v;
}

async function setItem(key: string, value: string): Promise<void> {
  _memSet(key, value);
  if (_mmkv) {
    try { _mmkv.set(key, value); return; } catch { /* fall through to FS */ }
  }
  await _chain(key, () => _fsWrite(key, value));
}

async function removeItem(key: string): Promise<void> {
  _mem.set(key, null);
  if (_mmkv) {
    try { _mmkv.delete(key); } catch { /* ignore */ }
  }
  await _chain(key, () => _fsDelete(key));
  try { await RealAsyncStorage.removeItem(key); } catch { /* ignore */ }
}

async function getAllKeys(): Promise<string[]> {
  const out = new Set<string>();
  if (_mmkv) {
    try { for (const k of _mmkv.getAllKeys()) out.add(k); } catch { /* ignore */ }
  }
  try {
    await ensureDir();
    const files = await FileSystem.readDirectoryAsync(DIR);
    for (const f of files) {
      if (f.endsWith('.kv')) out.add(dec(f.slice(0, -3)));
    }
  } catch { /* ignore */ }
  try {
    const legacy = await RealAsyncStorage.getAllKeys();
    for (const k of legacy) out.add(k);
  } catch { /* ignore */ }
  return Array.from(out);
}

async function multiGet(keys: readonly string[]): Promise<Array<[string, string | null]>> {
  const out: Array<[string, string | null]> = [];
  for (const k of keys) out.push([k, await getItem(k)]);
  return out;
}

async function multiSet(pairs: readonly (readonly [string, string])[]): Promise<void> {
  for (const [k, v] of pairs) await setItem(k, v);
}

async function multiRemove(keys: readonly string[]): Promise<void> {
  for (const k of keys) await removeItem(k);
}

async function mergeItem(key: string, value: string): Promise<void> {
  try {
    const cur = await getItem(key);
    if (!cur) { await setItem(key, value); return; }
    const a = JSON.parse(cur);
    const b = JSON.parse(value);
    await setItem(key, JSON.stringify({ ...a, ...b }));
  } catch { /* ignore */ }
}

async function clear(): Promise<void> {
  try {
    _mem.clear();
    _writeChains.clear();
    if (_mmkv) { try { _mmkv.clearAll(); } catch { /* ignore */ } }
    await FileSystem.deleteAsync(DIR, { idempotent: true });
    _dirReady = null;
  } catch { /* ignore */ }
  try { await RealAsyncStorage.clear(); } catch { /* ignore */ }
}

const AsyncStorage = {
  getItem,
  setItem,
  removeItem,
  getAllKeys,
  multiGet,
  multiSet,
  multiRemove,
  mergeItem,
  clear,
};

export default AsyncStorage;
'@

  [System.IO.File]::WriteAllText($shimPath, $shim)
  Write-Host "[OK] shim upgraded to V377 tri-tier (backup: .bak_v377)" -ForegroundColor Green
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V377 applied. Next steps:" -ForegroundColor Cyan
Write-Host "  1. deploy_ota.bat   (current APK keeps working via FS engine)"
Write-Host "  2. Rebuild the APK the same way you built the current one."
Write-Host "     If you use prebuild:  npx expo prebuild --platform android --clean"
Write-Host "     (autolinking picks up MMKV automatically)"
Write-Host "  3. adb install -r the new APK on the Firestick."
Write-Host "  4. Verify boot log:  adb logcat | findstr kvStore"
Write-Host "     -> must say: MMKV native engine ACTIVE"
Write-Host "  5. Confirm you are still logged in + progress intact."
Write-Host "=========================================" -ForegroundColor Cyan
