# ============================================================================
# patch_v387.ps1 - no resume flash + stable overlay image from frame 1 (OTA)
#
# [A] RESUME FLASH: the player hid the loading screen 400ms after playback
#     started, but the Continue-Watching resume SEEK happens on a later
#     status tick - so the video visibly played from 0:00 for a moment,
#     then jumped. Fix: while a resume seek is pending, hold the loading
#     screen until the seek lands (5s failsafe so it can never hang).
#
# [B] TWO SCREENS ON CW: when the details autoplay overlay first paints,
#     content meta hasn't loaded - the overlay starts as a BLACK screen
#     with text, then the backdrop pops in = reads as two different
#     loading screens. CW passes the poster as a param, so put it FIRST
#     in the image chain: the overlay paints instantly with a stable image
#     that never swaps, and the player inherits the exact same image.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V387 Resume Hold + Stable Overlay" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# [B] details [id].tsx - poster param first in overlay image chain
# ---------------------------------------------------------------------------
$dPath = Get-ChildItem -Path 'app' -Recurse -File | Where-Object { $_.Name -eq '[id].tsx' } | Select-Object -First 1
if (-not $dPath) { Write-Host "[FATAL] [id].tsx not found" -ForegroundColor Red; exit 1 }
$d = [System.IO.File]::ReadAllText($dPath.FullName)

if ($d.Contains('paramPoster || currentEpisode?.thumbnail')) {
  Write-Host "[SKIP] [id].tsx already patched" -ForegroundColor Yellow
} else {
  $old = '(currentEpisode?.thumbnail || nextBackdropParam'
  $new = '(paramPoster /* V387_STABLE_OVERLAY_IMAGE */ || currentEpisode?.thumbnail || nextBackdropParam'
  if (-not $d.Contains($old)) { Write-Host "[FATAL] B anchor missing" -ForegroundColor Red; exit 1 }
  $count = ([regex]::Matches($d, [regex]::Escape($old))).Count
  $d = $d.Replace($old, $new)
  [System.IO.File]::WriteAllText($dPath.FullName, $d)
  Write-Host "[OK] B: image chain updated at $count sites (overlay + player param)" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# [A] player.tsx - hold loading screen until resume seek lands
# ---------------------------------------------------------------------------
$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V387_HOLD_TILL_RESUME')) {
  Write-Host "[SKIP] player.tsx already patched" -ForegroundColor Yellow
} else {

$old = @'
        // Animate progress to 100% then hide loading after a brief delay
        setDownloadProgress(100);
        // Small delay to show the completed animation before hiding
        setTimeout(() => {
          setIsLoading(false);
        }, 400);
'@
$new = @'
        // Animate progress to 100% then hide loading after a brief delay
        setDownloadProgress(100);
        /* V387_HOLD_TILL_RESUME - if a Continue-Watching resume seek is
           still pending, keep the loading screen up until the seek lands
           so the user never sees the video flash frame 0:00 first.
           5s failsafe so a failed seek can never hang the screen. */
        if (pendingResumePosition && pendingResumePosition > 0 && !hasResumedRef.current) {
          setTimeout(() => { setIsLoading(false); }, 5000);
        } else {
          setTimeout(() => { setIsLoading(false); }, 400);
        }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] A1 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] A1: hold loading during pending resume" -ForegroundColor Green

$old = @'
            console.log(`[PLAYER] Resume position past 95%, not resuming`);
            hasResumedRef.current = true;
            setPendingResumePosition(null);
'@
$new = @'
            console.log(`[PLAYER] Resume position past 95%, not resuming`);
            hasResumedRef.current = true;
            setPendingResumePosition(null);
            setIsLoading(false); /* V387_HOLD_TILL_RESUME */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] A2 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] A2: release on past-95% skip" -ForegroundColor Green

$old = @'
              console.log(`[PLAYER] Resume complete - at position: ${currentPos/1000}s`);
              hasResumedRef.current = true;
              setPendingResumePosition(null);
'@
$new = @'
              console.log(`[PLAYER] Resume complete - at position: ${currentPos/1000}s`);
              hasResumedRef.current = true;
              setPendingResumePosition(null);
              setTimeout(() => { setIsLoading(false); }, 150); /* V387_HOLD_TILL_RESUME */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] A3 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] A3: release when resume seek lands" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[DONE] player.tsx written" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch twice." -ForegroundColor Cyan
Write-Host ""
