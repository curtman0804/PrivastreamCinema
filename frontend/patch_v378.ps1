# ============================================================================
# patch_v378.ps1 — MMKV init error unmasker
#
# Context: APK compiles NitroModules + NitroMmkv fine (C++ libs load per
# logcat), but the JS shim's `new MMKV()` throws and the generic catch
# swallows the real exception, printing only:
#   [kvStore] MMKV native unavailable - FS engine active
#
# This patch appends a V378 PROBE block to the end of the kv shim file.
# The probe independently requires react-native-mmkv + nitro-modules and
# logs the EXACT error message + stack so we can see why init fails.
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP] per step.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V378 MMKV Error Unmasker" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ------------------------------------------------------------------
# Locate the kv shim file (the one printing the fallback message)
# ------------------------------------------------------------------
$candidates = Get-ChildItem -Path 'src','app' -Recurse -Include *.ts,*.tsx -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Where-Object { (Get-Content -LiteralPath $_.FullName -Raw) -match 'MMKV native unavailable' }

if (-not $candidates -or $candidates.Count -eq 0) {
  Write-Host "[FATAL] Could not find any file containing 'MMKV native unavailable'." -ForegroundColor Red
  Write-Host "        Are you in the right directory? CWD = $(Get-Location)" -ForegroundColor Red
  exit 1
}

foreach ($f in $candidates) {
  $abs = $f.FullName
  $txt = [System.IO.File]::ReadAllText($abs)

  if ($txt.Contains('V378_PROBE')) {
    Write-Host "[SKIP] Probe already present in $abs" -ForegroundColor Yellow
    continue
  }

  $probe = @'

// ============================================================================
// V378_PROBE — independent MMKV init probe. Logs the EXACT failure reason.
// Remove after debugging.
// ============================================================================
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _v378mod: any = require('react-native-mmkv');
  console.log('[kvStore][V378] mmkv module keys=' + Object.keys(_v378mod || {}).join(','));
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const _v378nitro: any = require('react-native-nitro-modules');
    console.log('[kvStore][V378] nitro module keys=' + Object.keys(_v378nitro || {}).join(','));
    try {
      const _v378box = _v378nitro.NitroModules
        ? _v378nitro.NitroModules.createHybridObject('MmkvPlatformContext')
        : null;
      console.log('[kvStore][V378] MmkvPlatformContext=' + (_v378box ? 'OK' : 'NitroModules missing'));
    } catch (e3: any) {
      console.log('[kvStore][V378] MmkvPlatformContext ERR=' + (e3 && e3.message ? e3.message : String(e3)));
    }
  } catch (e2: any) {
    console.log('[kvStore][V378] nitro require ERR=' + (e2 && e2.message ? e2.message : String(e2)));
  }
  const _v378i = new _v378mod.MMKV({ id: 'v378probe' });
  _v378i.set('t', '1');
  console.log('[kvStore][V378] MMKV constructor OK, roundtrip=' + _v378i.getString('t'));
} catch (e: any) {
  console.log('[kvStore][V378] MMKV init ERR=' + (e && e.message ? e.message : String(e)));
  console.log('[kvStore][V378] MMKV init STACK=' + (e && e.stack ? String(e.stack).slice(0, 600) : 'none'));
}
'@

  [System.IO.File]::WriteAllText($abs, $txt + $probe)
  Write-Host "[OK] Probe appended to $abs" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Now run deploy_ota.bat, relaunch the app on the Firestick," -ForegroundColor Cyan
Write-Host "then capture:  adb logcat -d | findstr V378" -ForegroundColor Cyan
Write-Host ""
