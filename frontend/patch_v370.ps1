# ============================================================================
# patch_v370.ps1 (pure ASCII) - details in/out lag: kill the comparator storm
#
# From lag_capture.log, entering details stalled the JS thread ~850ms between
# "[v337] kept" and "[V357 PARTITION]", plus a 505ms GC pause right after:
#   - computeScore (~50 regex tests + ~8 string allocations per call) ran
#     INSIDE the sort comparator.  For 59 streams that is ~700 comparator
#     calls -> ~35,000 regex executions + massive allocation churn, instead
#     of scoring each stream once (59 calls).
#   - The [V339] QxR log also fired inside computeScore (hot path).
#   - On back-nav, the CW refetch fired 51ms after the BACK keyup, so its
#     work overlapped the screen re-attach frame.
#
# Fix (2 files):
#   [id.tsx]
#     p1 V370_PRECOMPUTED_SCORES - score once per stream, sort by the number
#     p2 V370_KILL_HOT_LOG       - silence [V339] log inside computeScore
#   [discover.tsx]
#     p3 V370_POST_NAV_SETTLE    - delay focus-effect CW refetch 400ms so the
#                                  back-transition frame lands first
#
# Idempotent: safe to re-run. Prints [OK]/[SKIP]/[FATAL] per patch.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V370 details transition lag fix" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ------------------------------------------------------------------
# id.tsx
# ------------------------------------------------------------------
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) {
  Write-Host "[FATAL] $idPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

# --- Patch 1: precomputed scores ---------------------------------------------
if ($id.Contains('V370_PRECOMPUTED_SCORES')) {
  Write-Host "[SKIP] id.tsx p1 already applied" -ForegroundColor Yellow
} else {
  $old1 = @'
    const _v357_sortScore = (a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream);
    _v357_cSdr.sort(_v357_sortScore); _v357_cHdr.sort(_v357_sortScore);
    _v357_uSdr.sort(_v357_sortScore); _v357_uHdr.sort(_v357_sortScore);
'@

  $new1 = @'
    /* V370_PRECOMPUTED_SCORES - computeScore (~50 regex tests + ~8 string
       allocations per call) ran INSIDE the sort comparator: ~700 calls for
       59 streams instead of 59.  That was the 850ms JS stall between
       [v337] and [V357 PARTITION] plus the 505ms GC pause in
       lag_capture.log.  Score each stream ONCE, then sort by the number. */
    const _v370Score = (p: any) => {
      if (p.__v370Score === undefined) p.__v370Score = computeScore(p.info, p.stream);
      return p.__v370Score;
    };
    for (const _p of _v357_cSdr) _v370Score(_p);
    for (const _p of _v357_cHdr) _v370Score(_p);
    for (const _p of _v357_uSdr) _v370Score(_p);
    for (const _p of _v357_uHdr) _v370Score(_p);
    const _v357_sortScore = (a: any, b: any) => _v370Score(b) - _v370Score(a);
    _v357_cSdr.sort(_v357_sortScore); _v357_cHdr.sort(_v357_sortScore);
    _v357_uSdr.sort(_v357_sortScore); _v357_uHdr.sort(_v357_sortScore);
'@

  if (-not $id.Contains($old1)) {
    Write-Host "[FATAL] id.tsx p1 anchor not found (V357 sort block drifted)" -ForegroundColor Red
    exit 1
  }
  $id = $id.Replace($old1, $new1)
  Write-Host "[OK] id.tsx p1: scores precomputed once per stream" -ForegroundColor Green
}

# --- Patch 2: silence the [V339] hot-path log --------------------------------
if ($id.Contains('V370_KILL_HOT_LOG')) {
  Write-Host "[SKIP] id.tsx p2 already applied" -ForegroundColor Yellow
} else {
  $old2 = @'
        console.log('[V339] QxR/r00t penalty -2500 |', String(stream.name || '').slice(0, 80));
'@

  $new2 = @'
        /* V370_KILL_HOT_LOG - fired inside computeScore (hot path). */
        false && console.log('[V339] QxR/r00t penalty -2500 |', String(stream.name || '').slice(0, 80));
'@

  if (-not $id.Contains($old2)) {
    Write-Host "[FATAL] id.tsx p2 anchor not found (V339 log drifted)" -ForegroundColor Red
    exit 1
  }
  $id = $id.Replace($old2, $new2)
  Write-Host "[OK] id.tsx p2: [V339] hot-path log silenced" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($idAbs, $id)

# ------------------------------------------------------------------
# discover.tsx
# ------------------------------------------------------------------
$dPath = 'app\(tabs)\discover.tsx'
if (!(Test-Path -LiteralPath $dPath)) {
  Write-Host "[FATAL] $dPath not found. Wrong CWD?" -ForegroundColor Red
  exit 1
}
$dAbs = (Resolve-Path -LiteralPath $dPath).Path
$d = [System.IO.File]::ReadAllText($dAbs)

if ($d.Contains('V370_POST_NAV_SETTLE')) {
  Write-Host "[SKIP] discover p3 already applied" -ForegroundColor Yellow
} else {
  $old3 = @'
        if (cwElapsed >= 30000) fetchContinueWatching();
'@

  $new3 = @'
        /* V370_POST_NAV_SETTLE - the CW refetch fired 51ms after the BACK
           keyup, so its request + state commit competed with the screen
           re-attach frame.  400ms lets the transition land first. */
        if (cwElapsed >= 30000) setTimeout(() => { try { fetchContinueWatching(); } catch (_) {} }, 400);
'@

  if (-not $d.Contains($old3)) {
    Write-Host "[FATAL] discover p3 anchor not found (focus-effect CW line drifted)" -ForegroundColor Red
    exit 1
  }
  $d = $d.Replace($old3, $new3)
  Write-Host "[OK] discover p3: CW refetch deferred 400ms after focus" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($dAbs, $d)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V370 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V370_PRECOMPUTED_SCORES" "app\details\[type]\[id].tsx"'
Write-Host '  findstr /C:"V370_POST_NAV_SETTLE" app\(tabs)\discover.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
