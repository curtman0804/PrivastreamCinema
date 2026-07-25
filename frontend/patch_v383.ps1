# ============================================================================
# patch_v383.ps1 - poster consistency: persist + sync-hydrate the registry
#
# ROOT CAUSE: the V160 poster registry (single source of truth for poster
# URLs) was in-memory only. It reset on every launch and only filled when a
# rail ContentCard actually MOUNTED - and since V371 viewport-rails, most
# rails never mount. So Continue Watching often painted its own stale
# watch-progress poster while the rails showed the canonical one, and the
# "winner" changed between sessions.
#
# FIX: persist the registry to MMKV (throttled write-through) and hydrate it
# SYNCHRONOUSLY at module load, so rails, CW, search and library all agree
# from the very first paint - and stay stable across sessions.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V383 Poster Registry Persistence" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$p = 'src\components\ContentCard.tsx'
if (!(Test-Path -LiteralPath $p)) {
  Write-Host "[FATAL] $p not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$abs = (Resolve-Path -LiteralPath $p).Path
$s = [System.IO.File]::ReadAllText($abs)

if ($s.Contains('V383_POSTER_PERSIST')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

# --- Patch 1: persist on every new registration ------------------------------
$old1 = @'
  if (!_v160PosterRegistry[key]) {
    _v160PosterRegistry[key] = String(url);
'@
$new1 = @'
  if (!_v160PosterRegistry[key]) {
    _v160PosterRegistry[key] = String(url);
    _v383Persist(); /* V383_POSTER_PERSIST */
'@
if (-not $s.Contains($old1)) { Write-Host "[FATAL] anchor 1 not found" -ForegroundColor Red; exit 1 }
$s = $s.Replace($old1, $new1)
Write-Host "[OK] 1: persist on register" -ForegroundColor Green

# --- Patch 2: persistence + sync hydration block ------------------------------
$old2 = @'
  return () => {
    const s = _v166PosterSubs[key];
    if (s) { s.delete(cb); if (s.size === 0) delete _v166PosterSubs[key]; }
  };
}
'@
$new2 = @'
  return () => {
    const s = _v166PosterSubs[key];
    if (s) { s.delete(cb); if (s.size === 0) delete _v166PosterSubs[key]; }
  };
}

/* V383_POSTER_PERSIST - the registry was in-memory only: it reset every
   launch and only filled when a rail ContentCard actually mounted (V371
   viewport rails = most never do), so Continue Watching often painted a
   stale watch-progress poster instead of the canonical rail poster.
   Persist the registry to MMKV and hydrate it SYNCHRONOUSLY at module load
   so every surface agrees from first paint, stable across sessions. */
const _V383_REG_KEY = '@ps_poster_reg_v1';
let _v383Timer: any = null;
function _v383Persist(): void {
  if (_v383Timer) return;
  _v383Timer = setTimeout(() => {
    _v383Timer = null;
    try {
      /* light cap so the blob can never grow unbounded */
      if (Object.keys(_v160PosterRegistry).length > 3000) return;
      AsyncStorage.setItem(_V383_REG_KEY, JSON.stringify(_v160PosterRegistry)).catch(() => {});
    } catch (_) {}
  }, 1500);
}
function _v383Hydrate(raw: string | null): void {
  if (!raw) return;
  try {
    const obj = JSON.parse(raw) as Record<string, string>;
    for (const k of Object.keys(obj)) {
      if (!_v160PosterRegistry[k] && obj[k]) {
        _v160PosterRegistry[k] = obj[k];
        const subs = _v166PosterSubs[k];
        if (subs && subs.size) subs.forEach(cb => { try { cb(obj[k]); } catch (_) {} });
      }
    }
  } catch (_) {}
}
/* Sync hydrate straight from MMKV (same instance id as the kv shim) so the
   registry is already full BEFORE the first card renders. Falls back to the
   async shim on devices without native MMKV. */
let _v383Hydrated = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const _v383m: any = require('react-native-mmkv');
  const _v383inst: any = _v383m.createMMKV
    ? _v383m.createMMKV({ id: 'privastream-kv-v1' })
    : new _v383m.MMKV({ id: 'privastream-kv-v1' });
  const _v383raw = _v383inst.getString(_V383_REG_KEY);
  _v383Hydrate(_v383raw === undefined ? null : _v383raw);
  _v383Hydrated = true;
} catch (_) { /* no native MMKV on this device */ }
if (!_v383Hydrated) {
  AsyncStorage.getItem(_V383_REG_KEY).then(_v383Hydrate).catch(() => {});
}
'@
if (-not $s.Contains($old2)) { Write-Host "[FATAL] anchor 2 not found" -ForegroundColor Red; exit 1 }
$s = $s.Replace($old2, $new2)
Write-Host "[OK] 2: persistence + sync hydration" -ForegroundColor Green

[System.IO.File]::WriteAllText($abs, $s)
Write-Host ""
Write-Host "[DONE] ContentCard.tsx written. Run deploy_ota.bat." -ForegroundColor Green
Write-Host ""
