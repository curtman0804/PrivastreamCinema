# ============================================================================
# patch_v392.ps1 - Skip Intro becomes a selectable popup button (OTA)
#
# REQUIRES: patch_v390.ps1 applied first (adds the V391 skip-intro core).
#
# CHANGE: the V391 pill was passive (SELECT-with-controls-hidden hack).
# Now it's a real focusable button like the "Up Next" popup: it appears
# bottom-right during the intro window, grabs D-pad focus (only when the
# controls are hidden, so it never hijacks control navigation), lights up
# gold when focused, and pressing SELECT activates it -> +85s.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V392 Skip Intro Focus Button" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V392_SKIP_INTRO_BUTTON')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V391_SKIP_INTRO')) {
  Write-Host "[FATAL] V390 not applied yet - run patch_v390.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: replace controls-hidden tracker with a shared skip action ---
$old = @'
  const _v391ControlsVisibleRef = useRef(true);
  useEffect(() => { _v391ControlsVisibleRef.current = showControls; }, [showControls]);
'@
$new = @'
  /* V392_SKIP_INTRO_BUTTON - shared skip action for the focusable button. */
  const _v391Skip = useCallback(() => {
    if (_v391DoneRef.current) return;
    console.log('[V392] Skip Intro pressed: +85s');
    _v391DoneRef.current = true;
    _v391SkipVisibleRef.current = false;
    setV391SkipVisible(false);
    try {
      const _np = Math.min(
        (durationRef.current || Number.MAX_SAFE_INTEGER) - 1000,
        positionRef.current + 85000
      );
      if (videoRef.current) videoRef.current.setPositionAsync(Math.max(0, _np));
    } catch (_) {}
  }, []);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: skip action" -ForegroundColor Green

# --- 2: drop the now-unused hidden-state snapshot ---
$old = @'
      const _v391WasHidden = !_v391ControlsVisibleRef.current; /* V391_SKIP_INTRO */
      // Show controls on any button press
'@
$new = @'
      // Show controls on any button press
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: snapshot removed" -ForegroundColor Green

# --- 3: remove the emitter-based skip (native button press replaces it) ---
$old = @'
        case 'select':
          /* V391_SKIP_INTRO - pill visible + controls were hidden = skip. */
          if (_v391WasHidden && _v391SkipVisibleRef.current && videoRef.current) {
            console.log('[V391] Skip Intro: +85s');
            _v391DoneRef.current = true;
            _v391SkipVisibleRef.current = false;
            setV391SkipVisible(false);
            try {
              const _v391Np = Math.min(
                (durationRef.current || Number.MAX_SAFE_INTEGER) - 1000,
                positionRef.current + 85000
              );
              videoRef.current.setPositionAsync(Math.max(0, _v391Np));
            } catch (_) {}
            try { setShowControls(false); } catch (_) {}
          }
          break;
'@
$new = @'
        case 'select':
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: emitter skip removed" -ForegroundColor Green

# --- 4: passive pill -> focusable Up-Next-style button ---
$old = @'
            {/* V391_SKIP_INTRO - pill; SELECT (controls hidden) skips +85s */}
            {_v391SkipVisible && !showControls && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 96,
                  right: 48,
                  backgroundColor: 'rgba(15,15,15,0.88)',
                  borderColor: '#B8A05C',
                  borderWidth: 1.5,
                  borderRadius: 24,
                  paddingHorizontal: 22,
                  paddingVertical: 10,
                  zIndex: 40,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.4 }}>
                  Skip Intro  ⏭
                </Text>
              </View>
            )}
'@
$new = @'
            {/* V392_SKIP_INTRO_BUTTON - focusable card like the Up Next
                popup: grabs focus while controls are hidden so a single
                SELECT press activates it; lights up gold when focused. */}
            {_v391SkipVisible && (
              <TVFocusButton
                onPress={_v391Skip}
                hasTVPreferredFocus={!showControls}
                style={{
                  position: 'absolute',
                  bottom: 96,
                  right: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: 'rgba(15,15,15,0.92)',
                  borderColor: '#333',
                  borderWidth: 1.5,
                  borderRadius: 8,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  zIndex: 60,
                }}
                focusedStyle={{
                  borderColor: '#B8A05C',
                  backgroundColor: 'rgba(32,29,20,0.98)',
                  transform: [{ scale: 1.05 }],
                }}
              >
                <Ionicons name="play-skip-forward" size={16} color="#B8A05C" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.4, marginLeft: 10 }}>
                  Skip Intro
                </Text>
              </TVFocusButton>
            )}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 4 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] 4: focusable button - player.tsx written" -ForegroundColor Green
Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch twice." -ForegroundColor Cyan
Write-Host ""
