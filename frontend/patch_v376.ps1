# ============================================================================
# patch_v376.ps1 - MMKV migration, phase 1 (OTA-able, no native rebuild)
#
# Problem: Android's AsyncStorage is SQLite with a ~6 MB cap -> SQLITE_FULL.
# The V268 "swallow" wrapper stops crashes but writes still silently FAIL
# when full (confirmed still active in lag3.log boot line).
#
# Real react-native-mmkv is a NATIVE module = new APK + re-sideload on every
# customer device.  This patch instead replaces the storage ENGINE inside
# src\utils\mmkvStorage.ts (which most call-sites already import) with a
# file-system-backed KV store (expo-file-system/legacy):
#   - no size limit, no SQLite, ships via OTA
#   - reversible key encoding (no collisions, getAllKeys returns real keys)
#   - in-memory read cache (<256 KB values) - repeat reads are instant
#   - per-key write serialization - no interleaved file writes
#   - NO auto-eviction (this is persistent storage, not a cache)
#   - LAZY MIGRATION: any read that misses falls through to the old SQLite
#     store, copies the value forward, and never looks back.  Auth tokens,
#     PM keys, watch progress all migrate transparently - nobody logs out.
#
# Also re-runs the V344 codemod so remaining direct AsyncStorage importers
# (authStore.ts, client.ts, premiumizeClient.ts, profile.tsx, addons.tsx,
# and anything else) route through the shim.
#
# When you next do a native APK build we can add the real MMKV tier on top
# (same shim, faster engine) with zero call-site changes.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per step.
# ============================================================================

$ErrorActionPreference = 'Stop'
$Root = 'C:\Users\Curtm\PrivastreamCinema\frontend'
Set-Location $Root

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V376 FS-backed KV store (MMKV phase 1)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ------------------------------------------------------------------
# Step 1: replace src\utils\mmkvStorage.ts wholesale (backup first)
# ------------------------------------------------------------------
$shimPath = Join-Path $Root 'src\utils\mmkvStorage.ts'
$shimDir = Split-Path $shimPath -Parent
if (!(Test-Path -LiteralPath $shimDir)) { New-Item -ItemType Directory -Path $shimDir -Force | Out-Null }

$already = $false
if (Test-Path -LiteralPath $shimPath) {
  $cur = [System.IO.File]::ReadAllText($shimPath)
  if ($cur.Contains('V376_FS_KV')) { $already = $true }
  else { Copy-Item -LiteralPath $shimPath -Destination ($shimPath + '.bak_v376') -Force }
}

if ($already) {
  Write-Host "[SKIP] shim already V376" -ForegroundColor Yellow
} else {

$shim = @'
/* mmkvStorage.ts - V376_FS_KV
 *
 * AsyncStorage-compatible persistent KV store WITHOUT SQLite.
 * Backed by expo-file-system (one file per key) - no 6 MB cap, no
 * SQLITE_FULL, ships via OTA (no native module).
 *
 * - Reversible key encoding: no collisions, getAllKeys returns real keys.
 * - In-memory read cache for values < 256 KB: repeat reads are instant.
 * - Per-key write chains: concurrent writes to a key never interleave.
 * - NO eviction: this is persistent storage, not a cache.
 * - LAZY MIGRATION from the legacy SQLite AsyncStorage: a read that
 *   misses here falls back to SQLite, copies the value forward, and
 *   returns it.  Auth sessions and settings survive the switch.
 *
 * Future: when the app gets its next NATIVE build, a react-native-mmkv
 * tier can be added at the top of this file with zero call-site changes.
 */
import * as FileSystem from 'expo-file-system/legacy';
import RealAsyncStorage from '@react-native-async-storage/async-storage';

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

/* Reversible, filename-safe key encoding. */
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

async function getItem(key: string): Promise<string | null> {
  if (_mem.has(key)) return _mem.get(key) ?? null;
  let v = await _fsRead(key);
  if (v === null) {
    /* V376 lazy migration from the legacy SQLite store */
    try { v = await RealAsyncStorage.getItem(key); } catch { v = null; }
    if (v !== null) {
      const vv = v;
      _chain(key, () => _fsWrite(key, vv));
    }
  }
  _memSet(key, v);
  return v;
}

async function setItem(key: string, value: string): Promise<void> {
  _memSet(key, value);
  await _chain(key, () => _fsWrite(key, value));
}

async function removeItem(key: string): Promise<void> {
  _mem.set(key, null);
  await _chain(key, () => _fsDelete(key));
  try { await RealAsyncStorage.removeItem(key); } catch { /* ignore */ }
}

async function getAllKeys(): Promise<string[]> {
  const out = new Set<string>();
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
  Write-Host "[OK] shim replaced: src\utils\mmkvStorage.ts (backup: .bak_v376)" -ForegroundColor Green
}

# ------------------------------------------------------------------
# Step 2: codemod - route remaining direct AsyncStorage imports via the shim
# ------------------------------------------------------------------
function Get-RelativePathCompat([string]$fromDir, [string]$toFile) {
  $fromUri = New-Object System.Uri(($fromDir.TrimEnd('\','/') + '\'))
  $toUri = New-Object System.Uri($toFile)
  $rel = $fromUri.MakeRelativeUri($toUri).ToString()
  $rel = [Uri]::UnescapeDataString($rel) -replace '\\', '/'
  if (-not ($rel.StartsWith('.'))) { $rel = './' + $rel }
  return $rel
}

$shimNoExt = $shimPath -replace '\.ts$', ''
$files = Get-ChildItem -Path (Join-Path $Root 'app'), (Join-Path $Root 'src') -Recurse -Include *.ts, *.tsx -File -ErrorAction SilentlyContinue |
         Where-Object { $_.FullName -notmatch 'node_modules|\.bak|mmkvStorage\.ts|mmkvMigrate\.ts' }

$targetImportRegex = 'from\s+[''"]@react-native-async-storage/async-storage[''"]'
$count = 0
foreach ($f in $files) {
  $c = [System.IO.File]::ReadAllText($f.FullName)
  if ($c -match $targetImportRegex) {
    $rel = Get-RelativePathCompat (Split-Path $f.FullName -Parent) ($shimNoExt + '.ts')
    $rel = $rel -replace '\.ts$', ''
    $newC = [System.Text.RegularExpressions.Regex]::Replace($c, $targetImportRegex, ("from '" + $rel + "'"))
    [System.IO.File]::WriteAllText($f.FullName, $newC)
    Write-Host ("[OK] rerouted: " + $f.FullName.Substring($Root.Length + 1) + " -> " + $rel) -ForegroundColor Green
    $count++
  }
}
if ($count -eq 0) {
  Write-Host "[SKIP] codemod: no direct AsyncStorage imports left" -ForegroundColor Yellow
} else {
  Write-Host ("[OK] codemod rerouted " + $count + " file(s)") -ForegroundColor Green
}

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V376 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V376_FS_KV" src\utils\mmkvStorage.ts'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "  After OTA: log in, play something, force-close, reopen -" -ForegroundColor Cyan
Write-Host "  session + progress must survive (lazy migration check)." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
