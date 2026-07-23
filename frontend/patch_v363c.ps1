# patch_v363c.ps1 - Surgical fix: restore the useCallback opening line
# ---------------------------------------------------------------------------
# THE EXACT BREAK (confirmed from uploaded file):
#   Line 558 in your discover.tsx literally reads:
#       $1
#   ...because patch_v363.ps1's regex escape emitted `$1` as literal text
#   instead of expanding capture group 1. This ate the opening
#   `const handleSectionFocus = useCallback((sectionKey: string) => {`
#   so Babel had nothing to close on `}, []);`.
#
# THE FIX (one line, surgical):
#   Replace the literal "  $1\n" (2-space indent + "$1" + newline) with the
#   correct useCallback opening. The rest of the debounce body + snap-abort
#   fix is already in the file and correct.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V363c  Surgical opening restore" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$discPath = 'app\(tabs)\discover.tsx'
$discAbs = (Resolve-Path -LiteralPath $discPath).Path
$disc = [System.IO.File]::ReadAllText($discAbs)

# Only match `$1` when it appears on its own line right before the
# V363 debounce comment. That's the exact scar left by the bad regex.
# We use System.String.Replace() -- NO regex, so `$1` is safe.
$brokenBlockCRLF = "`r`n  `$1`r`n    /* V363_SECTION_FOCUS_DEBOUNCE"
$brokenBlockLF   = "`n  `$1`n    /* V363_SECTION_FOCUS_DEBOUNCE"

$goodOpenCRLF = "`r`n  const handleSectionFocus = useCallback((sectionKey: string) => {`r`n    /* V363_SECTION_FOCUS_DEBOUNCE"
$goodOpenLF   = "`n  const handleSectionFocus = useCallback((sectionKey: string) => {`n    /* V363_SECTION_FOCUS_DEBOUNCE"

$applied = $false

if ($disc.Contains($brokenBlockCRLF)) {
  $disc = $disc.Replace($brokenBlockCRLF, $goodOpenCRLF)
  Write-Host "  [OK] CRLF variant patched" -ForegroundColor Green
  $applied = $true
} elseif ($disc.Contains($brokenBlockLF)) {
  $disc = $disc.Replace($brokenBlockLF, $goodOpenLF)
  Write-Host "  [OK] LF variant patched" -ForegroundColor Green
  $applied = $true
} else {
  # Fallback: raw line replace (no context) - only if the file has literally
  # `  $1` alone on a line and the debounce is present.
  if ($disc.Contains("V363_SECTION_FOCUS_DEBOUNCE") -and $disc.Contains("  `$1")) {
    # Replace the FIRST occurrence of "  $1" (as a standalone line with the
    # two-space indent) with the proper opening. Do a single-hit replace
    # via [regex] using the LITERAL text via [regex]::Escape.
    $escaped = [regex]::Escape("  `$1")
    # Anchor with `^` and `$` in multiline mode so we only hit the standalone-line
    # occurrence.
    $reLine = "(?m)^" + $escaped + "\s*$"
    $goodLine = "  const handleSectionFocus = useCallback((sectionKey: string) => {"
    if ($disc -match $reLine) {
      $disc = [regex]::Replace($disc, $reLine, $goodLine, 1)
      Write-Host "  [OK] Fallback line replace succeeded" -ForegroundColor Green
      $applied = $true
    }
  }
}

if (-not $applied) {
  Write-Host "  [FAIL] Could not find broken `$1 anchor - file may already be clean" -ForegroundColor Red
  Write-Host "         Verifying current state..." -ForegroundColor Yellow
  $hasBad = (Select-String -LiteralPath $discPath -Pattern '^\s*\$1\s*$' -AllMatches).Matches.Count
  $hasGood = (Select-String -LiteralPath $discPath -Pattern 'const handleSectionFocus = useCallback' -SimpleMatch).Count
  Write-Host ("           Standalone `$1 lines           : " + $hasBad) -ForegroundColor Gray
  Write-Host ("           handleSectionFocus useCallback : " + $hasGood) -ForegroundColor Gray
  if ($hasBad -eq 0 -and $hasGood -ge 1) {
    Write-Host "         => File appears already clean, moving to deploy" -ForegroundColor Yellow
  } else {
    Write-Host "         => Aborting; upload the file again and I'll re-inspect" -ForegroundColor Red
    exit 1
  }
}

[System.IO.File]::WriteAllText($discAbs, $disc)
Write-Host "  [WRITE] $discPath saved" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "----- Verification -----" -ForegroundColor Cyan
Write-Host ("  Standalone `$1 lines (should be 0) : " + (Select-String -LiteralPath $discPath -Pattern '^\s*\$1\s*$' -AllMatches).Matches.Count) -ForegroundColor Green
Write-Host ("  useCallback opening hits (should be >=1) : " + (Select-String -LiteralPath $discPath -Pattern 'const handleSectionFocus = useCallback' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V363_SECTION_FOCUS_DEBOUNCE hits          : " + (Select-String -LiteralPath $discPath -Pattern 'V363_SECTION_FOCUS_DEBOUNCE' -SimpleMatch).Count) -ForegroundColor Green
Write-Host ("  V363_SNAP_ABORT hits                      : " + (Select-String -LiteralPath $discPath -Pattern 'V363_SNAP_ABORT' -SimpleMatch).Count) -ForegroundColor Green

# ---------------------------------------------------------------------------
# Deploy + reload
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "----- Deploy + reload -----" -ForegroundColor Cyan
$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
if ($deployOut -match 'DONE' -and $deployOut -match '"updateId":"([^"]+)"') {
  Write-Host ("  [OK]   Deploy done, updateId=" + $Matches[1]) -ForegroundColor Green
} else {
  Write-Host "  [FAIL] Deploy did not complete cleanly" -ForegroundColor Red
  Write-Host $deployOut
  exit 1
}
& adb shell am force-stop com.privastream.cinema 2>&1 | Out-Null
Write-Host "  [OK]   Firestick app force-stopped" -ForegroundColor Green

Write-Host ""
Write-Host "Reopen app, test:" -ForegroundColor Yellow
Write-Host "  1) Rapid D-pad through 4-5 rails -> only settle at final row" -ForegroundColor Yellow
Write-Host "  2) Arrow past CW while snap timers queued -> no jerk back" -ForegroundColor Yellow
Write-Host "  3) Open stream-heavy title, back out -> unmount <500ms" -ForegroundColor Yellow
Write-Host ""
Write-Host "Verify with:" -ForegroundColor Yellow
Write-Host '  adb logcat -d ReactNativeJS:V *:S | findstr /I "V361_UNMOUNT V363 SQLITE"' -ForegroundColor Gray
