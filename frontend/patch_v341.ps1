# patch_v341_disable_scroll_rescue.ps1
# Disables V316_CW_SHORT_SCROLL_RESCUE in discover.tsx.
#
# The rescue was originally added when Android TV's focus engine sometimes
# scrolled the CW row into view but failed to deliver onFocus to any poster,
# leaving the selector stranded on Popular Movies. That race is now covered
# by V316b/c/d (event capture fix, poster claim tags, unmount release).
#
# What the rescue is doing NOW: any time the user scrolls the discover view
# back up into the 0-150 y range while focus is on a lower row (e.g. browsing
# ahead via DPAD-DOWN then scrolling back up manually), rescue force-snaps
# focus to CW. That's the annoying "selector snaps back down" behavior the
# user is seeing.
#
# V341 turns off the rescue trigger (short-circuits the `if` block) so
# manual scroll-with-focus-elsewhere no longer gets hijacked. Other V316
# fixes remain active.

$ErrorActionPreference = 'Stop'
$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\(tabs)\discover.tsx'

Write-Host "[V341] Patching $Target" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Target)) {
  Write-Host "ERROR: not found" -ForegroundColor Red; exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $Target -Destination "$Target.bak_v341_$stamp" -Force

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V341_RESCUE_DISABLED') {
  Write-Host "[V341] Already patched. Skipping." -ForegroundColor Yellow; exit 0
}

# Anchor: the rescue trigger's `if` line
$old = 'const stillNotCw = lastFocusedSection.current !== ''__cw__'';'
$new = @'
// V341_RESCUE_DISABLED - rescue was hijacking focus when user scrolled
        // back up with focus intentionally on a lower row. The original
        // race it fixed is now covered by V316b/c/d. Force stillNotCw=false
        // so the `if` block below never fires.
        const stillNotCw = false;
'@

if ($content.Contains($old)) {
  $content = $content.Replace($old, $new)
  Write-Host "  V316_RESCUE trigger disabled" -ForegroundColor Green
} else {
  Write-Host "  WARN: anchor not found; trying regex fallback" -ForegroundColor Yellow
  $regex = "const stillNotCw = lastFocusedSection\.current !== '__cw__';"
  if ($content -match $regex) {
    $content = [regex]::Replace($content, $regex, "// V341_RESCUE_DISABLED`n        const stillNotCw = false;")
    Write-Host "  V316_RESCUE trigger disabled (regex path)" -ForegroundColor Green
  } else {
    Write-Host "  ERROR: could not locate anchor - patch aborted" -ForegroundColor Red
    exit 1
  }
}

Set-Content -LiteralPath $Target -Value $content -NoNewline
Write-Host "[V341] Done. Run deploy_ota.bat next." -ForegroundColor Cyan
