# ============================================================================
# patch_v394.ps1 - ON-SCREEN skip-intro diagnostics + version badge (OTA)
#
# Network diagnostics (v393) never arrived - so v394 puts the answers ON
# THE TV SCREEN, no adb, no network needed:
#   1. The player loading screen footer now reads "Loading...  -  v394".
#      If you do NOT see "v394" there after updating, the OTA update is
#      NOT applying on the device (pipeline/device issue, not app logic).
#   2. During the first ~5.5 minutes of any episode, a small green debug
#      line appears top-left showing the exact skip-intro decision inputs:
#      type / started / pos / resume / done / show. Read it out and the
#      root cause is instantly known.
#
# REQUIRES: patch_v390 + v392 + v393 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V394 On-Screen Diagnostics" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V394_DEBUG')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V393_REMOTE_DEBUG')) {
  Write-Host "[FATAL] V393 not applied - run patch_v393.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: debug state ---
$old = @'
  const [_v391SkipVisible, setV391SkipVisible] = useState(false);
'@
$new = @'
  const [_v391SkipVisible, setV391SkipVisible] = useState(false);
  const [_v394Dbg, setV394Dbg] = useState(''); /* V394_DEBUG - on-screen line */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: state" -ForegroundColor Green

# --- 2: feed the on-screen line from the decision block ---
$old = @'
        if (_v391Show !== _v391SkipVisibleRef.current) {
          _v391SkipVisibleRef.current = _v391Show;
          setV391SkipVisible(_v391Show);
        }
'@
$new = @'
        /* V394_DEBUG - live decision line, auto-clears after 5.5 min */
        setV394Dbg(_v391Pos < 330000
          ? 'v394 type=' + String(contentType) + ' started=Y pos=' + Math.round(_v391Pos / 1000)
            + 's resume=' + String(parsedResumePosition) + ' done=' + String(_v391DoneRef.current)
            + ' show=' + String(_v391Show)
          : '');
        if (_v391Show !== _v391SkipVisibleRef.current) {
          _v391SkipVisibleRef.current = _v391Show;
          setV391SkipVisible(_v391Show);
        }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: decision feed" -ForegroundColor Green

# --- 3: feed from the BLOCKED branch too ---
$old = @'
        _v393Log('skipintro BLOCKED type=' + String(contentType) + ' started=' + String(playbackStarted)
'@
$new = @'
        setV394Dbg('v394 BLOCKED type=' + String(contentType) + ' started=' + String(playbackStarted)
          + ' done=' + String(_v391DoneRef.current) + ' pos=' + Math.round((status.positionMillis || 0) / 1000) + 's'); /* V394_DEBUG */
        _v393Log('skipintro BLOCKED type=' + String(contentType) + ' started=' + String(playbackStarted)
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: blocked feed" -ForegroundColor Green

# --- 4: render the on-screen line (top-left) ---
$old = @'
            {/* V392_SKIP_INTRO_BUTTON - focusable card like the Up Next
'@
$new = @'
            {/* V394_DEBUG - temporary on-screen diagnostic line */}
            {_v394Dbg !== '' && (
              <View pointerEvents="none" style={{ position: 'absolute', top: 36, left: 36, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, zIndex: 70 }}>
                <Text style={{ color: '#00FF66', fontSize: 13, fontWeight: '600' }}>{_v394Dbg}</Text>
              </View>
            )}

            {/* V392_SKIP_INTRO_BUTTON - focusable card like the Up Next
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 4 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 4: overlay" -ForegroundColor Green

# --- 5: version badge in the loading footer ---
$oldA = @'
              Loading...
'@
$oldB = @'
              Starting playback
'@
$newT = @'
              Loading...  -  v394
'@
if ($p.Contains($oldA)) { $p = $p.Replace($oldA, $newT); Write-Host "[OK] 5: badge (Loading...)" -ForegroundColor Green }
elseif ($p.Contains($oldB)) { $p = $p.Replace($oldB, $newT); Write-Host "[OK] 5: badge (Starting playback)" -ForegroundColor Green }
else { Write-Host "[WARN] 5: loading footer not found - badge skipped" -ForegroundColor Yellow }

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host ""
Write-Host "[DONE] player.tsx written. deploy_ota.bat + your force-close cycle." -ForegroundColor Green
Write-Host ""
