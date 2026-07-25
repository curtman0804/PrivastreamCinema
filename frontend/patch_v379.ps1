# ============================================================================
# patch_v379.ps1 - MMKV v4 API fix (OTA, no rebuild needed)
#
# ROOT CAUSE (found via V378 probe): the APK ships react-native-mmkv v4,
# which REMOVED `new MMKV(...)` in favor of `createMMKV(...)`, and renamed
# instance method `.delete(key)` to `.remove(key)`. The shim was calling the
# dead v3 API -> TypeError -> silent fallback to FS engine.
#
# FIX: inject a version-agnostic factory `_v379make(cfg)` that:
#   - uses createMMKV() when available (v4), else new MMKV() (v3)
#   - wraps the instance so `.delete()` works on both versions
# Then rewrite every `new MMKV(...)` / probe construction to use it.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP] per file.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V379 MMKV v4 API Fix" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$helper = @'
/* V379_MMKV_V4_COMPAT - react-native-mmkv v4 removed `new MMKV()` (now
 * `createMMKV()`) and renamed `.delete()` to `.remove()`. This factory works
 * on both v3 and v4 and returns an instance where BOTH .delete and .remove
 * exist, so downstream shim code never needs to care about the version. */
const _v379mod: any = require('react-native-mmkv');
const _v379make = (cfg?: any): any => {
  const m: any = _v379mod && _v379mod.createMMKV
    ? _v379mod.createMMKV(cfg)
    : new _v379mod.MMKV(cfg);
  if (typeof m.delete === 'function') return m; // v3 - use as-is
  // v4 HybridObject: wrap in plain JS object (can't add props to native obj)
  return {
    set: (k: any, v: any) => m.set(k, v),
    getString: (k: any) => m.getString(k),
    getNumber: (k: any) => m.getNumber(k),
    getBoolean: (k: any) => m.getBoolean(k),
    getBuffer: (k: any) => m.getBuffer && m.getBuffer(k),
    contains: (k: any) => m.contains(k),
    delete: (k: any) => m.remove(k),
    remove: (k: any) => m.remove(k),
    getAllKeys: () => m.getAllKeys(),
    clearAll: () => m.clearAll(),
    recrypt: (k: any) => m.encrypt && m.encrypt(k),
    trim: () => m.trim && m.trim(),
    addOnValueChangedListener: (cb: any) =>
      m.addOnValueChangedListener && m.addOnValueChangedListener(cb),
  };
};

'@

# Find every source file that constructs MMKV the old way (shim + V378 probe)
$targets = Get-ChildItem -Path 'src','app' -Recurse -Include *.ts,*.tsx -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'new\s+(?:_v378mod\.)?MMKV\s*\(' }

if (-not $targets -or $targets.Count -eq 0) {
  Write-Host "[FATAL] No files found containing 'new MMKV('. CWD = $(Get-Location)" -ForegroundColor Red
  exit 1
}

foreach ($f in $targets) {
  $abs = $f.FullName
  $s = [System.IO.File]::ReadAllText($abs)

  if ($s.Contains('V379_MMKV_V4_COMPAT')) {
    Write-Host "[SKIP] Already patched: $abs" -ForegroundColor Yellow
    continue
  }

  # 1) Rewrite all v3-style constructions to the compat factory
  $s2 = [regex]::Replace($s, 'new\s+(?:_v378mod\.)?MMKV\s*\(', '_v379make(')

  # 2) Prepend the compat helper (import hoisting makes top-of-file safe)
  $s2 = $helper + $s2

  [System.IO.File]::WriteAllText($abs, $s2)
  Write-Host "[OK] Patched: $abs" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Now run deploy_ota.bat, relaunch the app TWICE, then verify:" -ForegroundColor Cyan
Write-Host '  adb logcat -d | findstr /C:"V378" /C:"kvStore"' -ForegroundColor Cyan
Write-Host "Expect: '[kvStore][V378] MMKV constructor OK, roundtrip=1'" -ForegroundColor Cyan
Write-Host "        and NO 'FS engine active' line." -ForegroundColor Cyan
Write-Host ""
