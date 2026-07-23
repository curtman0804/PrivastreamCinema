# patch_v363f.ps1 - mmkvMigrate.ts line-31 leftover amputation + diagnosed deploy
# ---------------------------------------------------------------------------
# ROOT CAUSE (final piece): V361's regex `ensureMMKVMigrated[^{]*\{` stopped at
# the FIRST `{` which was inside the return type `Promise<{ ... }>`. So the $1
# damage only ate the first half of the signature line; the leftover second
# half (` migrated: number; skipped: number; failed: number }> {`) stayed and
# ended up glued to the injected return line:
#   return { migrated: 0, skipped: 0, failed: 0 }; migrated: number; ... }> {
# v363d already restored the full signature on line 29, so the fix is simply
# to cut the trailing junk off that return line. Brace balance stays correct
# because the junk's `}` and `{` cancel out.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V363f  mmkvMigrate leftover amputation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ============================================================================
# FIX : src\utils\mmkvMigrate.ts - cut leftover fragment off the return line
# ============================================================================
$mmPath = 'src\utils\mmkvMigrate.ts'
$mmAbs  = (Resolve-Path -LiteralPath $mmPath).Path
$mtxt   = [System.IO.File]::ReadAllText($mmAbs)
$mnl    = if ($mtxt.Contains("`r`n")) { "`r`n" } else { "`n" }
$mlines = $mtxt -split '\r?\n'

$fixed = $false
for ($j = 0; $j -lt $mlines.Length; $j++) {
  if ($mlines[$j].Contains('return { migrated: 0, skipped: 0, failed: 0 }') -and
      $mlines[$j].Contains('failed: number }> {')) {
    $mlines[$j] = '  return { migrated: 0, skipped: 0, failed: 0 };'
    $fixed = $true
    Write-Host ("  [OK]   mmkvMigrate.ts line " + ($j + 1) + " leftover fragment removed") -ForegroundColor Green
    break
  }
}
if ($fixed) {
  [System.IO.File]::WriteAllText($mmAbs, ($mlines -join $mnl))
  Write-Host "  [WRITE] $mmPath saved" -ForegroundColor Cyan
} else {
  Write-Host "  [NOOP] mmkvMigrate.ts: no glued return line found (already clean?)" -ForegroundColor DarkGray
}

# ============================================================================
# SWEEP : leftover literal $1 lines anywhere in app\ or src\
# ============================================================================
Write-Host ""
Write-Host "----- Sweep: leftover literal `$1 lines -----" -ForegroundColor Cyan
$sweep = Get-ChildItem -Recurse -Include *.ts,*.tsx -Path 'app','src' -ErrorAction SilentlyContinue |
         Select-String -Pattern '^\s*\$\d'
if ($sweep) {
  foreach ($hit in $sweep) {
    Write-Host ("  [BAD]  " + $hit.Path + ":" + $hit.LineNumber + "  " + $hit.Line.Trim()) -ForegroundColor Red
  }
  Write-Host "  PASTE THESE BACK TO THE AGENT. Skipping deploy." -ForegroundColor Red
  exit 1
} else {
  Write-Host "  [OK]   0 leftover `$1 lines" -ForegroundColor Green
}

# ============================================================================
# DEPLOY : run deploy_ota.bat, print EVERYTHING, auto-diagnose SyntaxErrors
# ============================================================================
Write-Host ""
Write-Host "----- Deploy (full output below) -----" -ForegroundColor Cyan
$deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
Write-Host $deployOut

if ($deployOut -match 'DONE' -and $deployOut -match '"updateId":"([^"]+)"') {
  Write-Host ("  [OK]   Deploy done, updateId=" + $Matches[1]) -ForegroundColor Green
  cmd /c "adb shell am force-stop com.privastream.cinema 2>&1" | Out-Null
  Write-Host "  [OK]   TV app force-stopped (reopen it to pull the update)" -ForegroundColor Green
  Write-Host ""
  Write-Host "Verify on TV:" -ForegroundColor Yellow
  Write-Host "  1) Arrow down through 4-5 rails FAST on Discover -> no ricochet" -ForegroundColor Yellow
  Write-Host "  2) Arrow up past CW -> no snap-back-to-top jump" -ForegroundColor Yellow
  Write-Host "  3) Open a stream-heavy title, back out -> should feel instant" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Then paste:" -ForegroundColor Yellow
  Write-Host '  adb logcat -d ReactNativeJS:V *:S | findstr /I "V361_UNMOUNT V363 SQLITE"' -ForegroundColor Gray
  exit 0
}

Write-Host "  [FAIL] Deploy did not complete cleanly - diagnosing..." -ForegroundColor Red

# Auto-extract failing file + line from a Babel/Metro SyntaxError
if ($deployOut -match 'SyntaxError[^\r\n]*?([A-Za-z]:\\[^:]+?\.(?:tsx|ts|jsx|js)):[^\(]*\((\d+):(\d+)\)') {
  $badFile = $Matches[1]
  $badLine = [int]$Matches[2]
  Write-Host ""
  Write-Host ("  Bundler SyntaxError in: " + $badFile) -ForegroundColor Red
  Write-Host ("  At line: " + $badLine) -ForegroundColor Red
  if (Test-Path -LiteralPath $badFile) {
    Write-Host "  ----- Code context -----" -ForegroundColor Yellow
    $ctx = Get-Content -LiteralPath $badFile
    $s = [Math]::Max(0, $badLine - 9); $e = [Math]::Min($ctx.Length - 1, $badLine + 7)
    for ($k = $s; $k -le $e; $k++) {
      $mark = if (($k + 1) -eq $badLine) { ' >>' } else { '   ' }
      Write-Host ("  " + ($k + 1).ToString().PadLeft(5) + $mark + ' ' + $ctx[$k])
    }
  }
  Write-Host ""
  Write-Host "  PASTE ALL OUTPUT ABOVE BACK TO THE AGENT for a surgical fix." -ForegroundColor Red
} else {
  Write-Host ""
  Write-Host "  No SyntaxError - failure is in a later step (upload/update-server)." -ForegroundColor Yellow
  Write-Host "  PASTE THE FULL DEPLOY OUTPUT ABOVE BACK TO THE AGENT." -ForegroundColor Yellow
}
