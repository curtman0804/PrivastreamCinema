# patch_v363d.ps1 - Restore [id].tsx return-block destroyed by V360's $1 bug
# ---------------------------------------------------------------------------
# ROOT CAUSE: patch_v360.ps1 used a .NET regex replacement of
#   ($marker + '$1'.Replace('$','$$'))  ->  "$$1"  ->  LITERAL "$1"
# which DELETED these three lines in app\details\[type]\[id].tsx:
#     return (
#     <View style={styles.container}>
#       {/* V176K_POPOVER_MOUNTED ... */}   (opening half of the comment)
# ...and replaced them with a literal "$1". The bundler never surfaced this
# until now because discover.tsx's own $1 error failed the build FIRST.
#
# patch_v361.ps1 had the SAME trap on src\utils\mmkvMigrate.ts (function
# opening line). This patch:
#   1) Restores the [id].tsx return block (line-based, NO regex).
#   2) Repairs mmkvMigrate.ts if its function opening was eaten.
#   3) SWEEPS every .ts/.tsx under app\ and src\ for leftover literal $1
#      lines so no more of these can hide.
#   4) Deploys + force-stops the app.
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V363d  [id].tsx return-block restore" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ============================================================================
# FIX 1 : app\details\[type]\[id].tsx - restore the eaten return block
# ============================================================================
$idPath = 'app\details\[type]\[id].tsx'
$idAbs  = (Resolve-Path -LiteralPath $idPath).Path
$txt    = [System.IO.File]::ReadAllText($idAbs)
$nl     = if ($txt.Contains("`r`n")) { "`r`n" } else { "`n" }
$lines  = $txt -split '\r?\n'

$fixed1 = $false
for ($i = 0; $i -lt $lines.Length; $i++) {
  # Broken line looks like:  "    $1 <emdash> Stremio-style menu host for this screen. */}"
  if ($lines[$i].Contains('$1') -and $lines[$i].Contains('Stremio-style menu host')) {
    $lines[$i] = '  return (' + $nl +
                 '    <View style={styles.container}>' + $nl +
                 '      {/* V176K_POPOVER_MOUNTED - Stremio-style menu host for this screen. */}'
    $fixed1 = $true
    Write-Host ("  [OK]   id.tsx broken line " + ($i + 1) + " restored (return + View + comment)") -ForegroundColor Green
    break
  }
}
if ($fixed1) {
  [System.IO.File]::WriteAllText($idAbs, ($lines -join $nl))
  Write-Host "  [WRITE] $idPath saved" -ForegroundColor Cyan
} else {
  Write-Host "  [NOOP] id.tsx: no broken `$1 Stremio line found (already clean?)" -ForegroundColor DarkGray
}

# ============================================================================
# FIX 2 : src\utils\mmkvMigrate.ts - repair function opening if V361 ate it
# ============================================================================
$mmPath = 'src\utils\mmkvMigrate.ts'
if (Test-Path -LiteralPath $mmPath) {
  $mmAbs   = (Resolve-Path -LiteralPath $mmPath).Path
  $mtxt    = [System.IO.File]::ReadAllText($mmAbs)
  $mnl     = if ($mtxt.Contains("`r`n")) { "`r`n" } else { "`n" }
  $mlines  = $mtxt -split '\r?\n'
  $fixed2  = $false
  for ($j = 0; $j -lt $mlines.Length; $j++) {
    if ($mlines[$j].Trim() -eq '$1') {
      # Which anchor did V361 destroy? Comment text on the next line tells us.
      $next = if ($j + 1 -lt $mlines.Length) { $mlines[$j + 1] } else { '' }
      if ($next.Contains('was rolled back')) {
        $mlines[$j] = 'export async function ensureMMKVMigrated(): Promise<{ migrated: number; skipped: number; failed: number }> {'
        Write-Host ("  [OK]   mmkvMigrate.ts line " + ($j + 1) + " restored -> ensureMMKVMigrated opening") -ForegroundColor Green
      } else {
        $mlines[$j] = 'async function _run(): Promise<{ migrated: number; skipped: number; failed: number }> {'
        Write-Host ("  [OK]   mmkvMigrate.ts line " + ($j + 1) + " restored -> _run opening") -ForegroundColor Green
      }
      $fixed2 = $true
    }
  }
  if ($fixed2) {
    [System.IO.File]::WriteAllText($mmAbs, ($mlines -join $mnl))
    Write-Host "  [WRITE] $mmPath saved" -ForegroundColor Cyan
  } else {
    Write-Host "  [NOOP] mmkvMigrate.ts: clean (V361 `$1 trap did not fire here)" -ForegroundColor DarkGray
  }
} else {
  Write-Host "  [SKIP] $mmPath not found" -ForegroundColor DarkGray
}

# ============================================================================
# SWEEP : any remaining literal $1 lines anywhere in app\ or src\ ?
# ============================================================================
Write-Host ""
Write-Host "----- Sweep: leftover literal `$1 lines in app\ + src\ -----" -ForegroundColor Cyan
$sweep = Get-ChildItem -Recurse -Include *.ts,*.tsx -Path 'app','src' -ErrorAction SilentlyContinue |
         Select-String -Pattern '^\s*\$\d'
if ($sweep) {
  foreach ($hit in $sweep) {
    Write-Host ("  [BAD]  " + $hit.Path + ":" + $hit.LineNumber + "  " + $hit.Line.Trim()) -ForegroundColor Red
  }
  Write-Host "  ^^^ PASTE THESE LINES BACK TO THE AGENT - do NOT deploy yet." -ForegroundColor Red
} else {
  Write-Host "  [OK]   0 leftover `$1 lines - codebase is clean" -ForegroundColor Green
}

# ============================================================================
# Deploy + reload (only if sweep is clean)
# ============================================================================
if (-not $sweep) {
  Write-Host ""
  Write-Host "----- Deploy + reload -----" -ForegroundColor Cyan
  $deployOut = & cmd /c "deploy_ota.bat 2>&1" | Out-String
  if ($deployOut -match 'DONE' -and $deployOut -match '"updateId":"([^"]+)"') {
    Write-Host ("  [OK]   Deploy done, updateId=" + $Matches[1]) -ForegroundColor Green
  } else {
    Write-Host "  [FAIL] Deploy did not complete cleanly" -ForegroundColor Red
    Write-Host $deployOut
  }
  & adb shell am force-stop com.privastream.cinema 2>&1 | Out-Null
  Write-Host "  [OK]   TV app force-stopped" -ForegroundColor Green

  Write-Host ""
  Write-Host "Reopen the app and verify:" -ForegroundColor Yellow
  Write-Host "  1) Arrow down through 4-5 rails FAST on Discover -> no ricochet" -ForegroundColor Yellow
  Write-Host "  2) Arrow up past CW -> no snap-back-to-top jump" -ForegroundColor Yellow
  Write-Host "  3) Open a stream-heavy title, back out -> UNMOUNT < 500ms" -ForegroundColor Yellow
  Write-Host ""
  Write-Host "Log check:" -ForegroundColor Yellow
  Write-Host '  adb logcat -d ReactNativeJS:V *:S | findstr /I "V361_UNMOUNT V363 SQLITE"' -ForegroundColor Gray
}
