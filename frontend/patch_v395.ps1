# ============================================================================
# patch_v395.ps1 - Skip Intro: working remote press + cleanup (OTA)
#
# From on-device testing (v394): the button APPEARS correctly, but native
# TV focus never reaches in-tree buttons on this build (only Modal buttons
# like Up Next get focus), so SELECT couldn't press it - and the 5:00
# window kept it on screen long after the intro.
#
# FIX:
#   1. SELECT on the remote (while controls are hidden) triggers the skip
#      via the key interceptor - the same guaranteed-delivery path the
#      seek keys use. Never fires while controls are open.
#   2. Button styled always-active (gold border) so it reads as pressable.
#   3. Window shortened to 0:15 - 2:00.
#   4. v394 green debug overlay + version badge removed.
#
# REQUIRES: v390+v392+v393+v394 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V395 Skip Intro Working Press" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V395_SKIP_PRESS')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V394_DEBUG')) {
  Write-Host "[FATAL] V394 not applied - run patch_v394.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: swap debug state for a controls-visibility ref ---
$old = @'
  const [_v394Dbg, setV394Dbg] = useState(''); /* V394_DEBUG - on-screen line */
'@
$new = @'
  const _v395CtrlRef = useRef(true); /* V395_SKIP_PRESS */
  useEffect(() => { _v395CtrlRef.current = showControls; }, [showControls]);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: controls ref" -ForegroundColor Green

# --- 2: remove debug feed from decision block + shorten window ---
$old = @'
        const _v391Show = _v391Pos >= 15000 && _v391Pos <= 300000
'@
$new = @'
        const _v391Show = _v391Pos >= 15000 && _v391Pos <= 120000
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: window 2:00" -ForegroundColor Green

$old = @'
        /* V394_DEBUG - live decision line, auto-clears after 5.5 min */
        setV394Dbg(_v391Pos < 330000
          ? 'v394 type=' + String(contentType) + ' started=Y pos=' + Math.round(_v391Pos / 1000)
            + 's resume=' + String(parsedResumePosition) + ' done=' + String(_v391DoneRef.current)
            + ' show=' + String(_v391Show)
          : '');
'@
$new = ''
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: debug feed removed" -ForegroundColor Green

$old = @'
        setV394Dbg('v394 BLOCKED type=' + String(contentType) + ' started=' + String(playbackStarted)
          + ' done=' + String(_v391DoneRef.current) + ' pos=' + Math.round((status.positionMillis || 0) / 1000) + 's'); /* V394_DEBUG */
'@
$new = ''
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 4 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 4: blocked feed removed" -ForegroundColor Green

# --- 5: snapshot hidden state, wire SELECT to the skip ---
$old = @'
      // Show controls on any button press
      showControlsWithTimeoutRef.current?.();
'@
$new = @'
      const _v395WasHidden = !_v395CtrlRef.current; /* V395_SKIP_PRESS */
      // Show controls on any button press
      showControlsWithTimeoutRef.current?.();
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 5 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 5: snapshot" -ForegroundColor Green

$old = @'
        case 'select':
        case 'up':
        case 'down':
          // D-pad events - just show controls (focus navigation handled natively)
          break;
'@
$new = @'
        case 'select':
          /* V395_SKIP_PRESS - remote SELECT presses the on-screen Skip
             Intro button (native TV focus never reaches in-tree buttons
             on this build; only Modals get focus). Controls-hidden guard
             keeps it from hijacking control navigation. */
          if (_v395WasHidden && _v391SkipVisibleRef.current) {
            _v391Skip();
            try { setShowControls(false); } catch (_) {}
          }
          break;
        case 'up':
        case 'down':
          // D-pad events - just show controls (focus navigation handled natively)
          break;
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 6 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 6: SELECT wired" -ForegroundColor Green

# --- 7: remove the green debug overlay ---
$old = @'
            {/* V394_DEBUG - temporary on-screen diagnostic line */}
            {_v394Dbg !== '' && (
              <View pointerEvents="none" style={{ position: 'absolute', top: 36, left: 36, backgroundColor: 'rgba(0,0,0,0.65)', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, zIndex: 70 }}>
                <Text style={{ color: '#00FF66', fontSize: 13, fontWeight: '600' }}>{_v394Dbg}</Text>
              </View>
            )}

'@
$new = ''
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 7 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 7: overlay removed" -ForegroundColor Green

# --- 8: always-active button look ---
$old = @'
                  borderColor: '#333',
'@
$new = @'
                  borderColor: '#B8A05C',
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 8 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 8: gold button" -ForegroundColor Green

# --- 9: badge off ---
$old = @'
              Loading...  -  v394
'@
$new = @'
              Loading...
'@
if ($p.Contains($old)) { $p = $p.Replace($old, $new); Write-Host "[OK] 9: badge removed" -ForegroundColor Green }
else { Write-Host "[SKIP] 9: badge not present" -ForegroundColor Yellow }

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host ""
Write-Host "[DONE] player.tsx written. deploy_ota.bat + force-close cycle." -ForegroundColor Green
Write-Host "NOTE: if the button still can't be pressed after OTA, the update" -ForegroundColor Yellow
Write-Host "pipeline is broken again -> rebuild APK like last time." -ForegroundColor Yellow
Write-Host ""
