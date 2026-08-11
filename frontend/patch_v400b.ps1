# ============================================================================
# patch_v400b.ps1 - Hotfix: v400's pill-kill missed the second line of the
# _v391Show expression (it wrapped across two lines joined by &&). The
# leftover `&& !(parsedResumePosition ...` line is now orphaned and blows
# up the bundler. This patch absorbs that trailing line into a harmless
# comment so the file parses. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V400b  Hotfix pill orphan" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V400B_ORPHAN_FIX')) {
  Write-Host "[SKIP] already patched" -ForegroundColor Yellow
  exit 0
}

$old = @'
        const _v391Show = false; /* V400_SKIP_KILL - Skip Intro disabled entirely (v396/v399 dormant) */ // was: _v399StartRef.current === null && _v391Pos >= 15000 && _v391Pos <= 120000
          && !(parsedResumePosition && parsedResumePosition * 1000 >= 240000);
'@
$new = @'
        const _v391Show = false; /* V400B_ORPHAN_FIX - Skip Intro pill fully disabled. */
        /* was:
           _v399StartRef.current === null && _v391Pos >= 15000 && _v391Pos <= 120000
           && !(parsedResumePosition && parsedResumePosition * 1000 >= 240000);
        */
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor missing - v400 must be applied and orphan line must still be present." -ForegroundColor Red
  Write-Host "Run and send me:" -ForegroundColor Yellow
  Write-Host '  findstr /N /C:"V400_SKIP_KILL" app\player.tsx' -ForegroundColor Yellow
  Write-Host '  findstr /N /C:"parsedResumePosition * 1000 >= 240000" app\player.tsx' -ForegroundColor Yellow
  exit 1
}
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] orphan trailing && line absorbed" -ForegroundColor Green
Write-Host ""
Write-Host "  Verify: findstr /C:'V400B_ORPHAN_FIX' app\player.tsx" -ForegroundColor Cyan
Write-Host "  Then re-run deploy_ota.bat" -ForegroundColor Cyan
