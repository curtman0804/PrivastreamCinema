# ============================================================================
# patch_v393.ps1 - remote skip-intro diagnostics (NO adb needed) (OTA)
#
# The app reports skip-intro state directly to the patch server over HTTPS,
# so we can debug WITHOUT logcat: play a fresh episode and the server log
# shows exactly why the button did or didn't appear.
#
# REQUIRES: patch_v390 + patch_v392 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V393 Remote Skip-Intro Diagnostics" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V393_REMOTE_DEBUG')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V392_SKIP_INTRO_BUTTON')) {
  Write-Host "[FATAL] V392 not applied - run patch_v392.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: remote log helper + boot ping ---
$old = @'
  /* V392_SKIP_INTRO_BUTTON - shared skip action for the focusable button. */
'@
$new = @'
  /* V393_REMOTE_DEBUG - no-adb diagnostics: reports skip-intro state to the
     patch server so issues can be debugged without logcat. Remove later. */
  const _v393LastRef = useRef('');
  const _v393Log = (msg: string) => {
    try {
      fetch('https://expo-android-tv.preview.emergentagent.com/api/devlog', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: msg,
      }).catch(() => {});
    } catch (_) {}
  };
  useEffect(() => {
    _v393Log('v393 bundle ACTIVE - player mounted id=' + String(contentId || '') + ' type=' + String(contentType || '') + ' resume=' + String(resumePosition || 'none'));
  }, []);

  /* V392_SKIP_INTRO_BUTTON - shared skip action for the focusable button. */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: log helper" -ForegroundColor Green

# --- 2: instrument the visibility state machine ---
$old = @'
      if (contentType === 'series' && playbackStarted && !_v391DoneRef.current) {
        const _v391Pos = status.positionMillis || 0;
        const _v391Show = _v391Pos >= 15000 && _v391Pos <= 300000
          && !(parsedResumePosition && parsedResumePosition * 1000 >= 240000);
        if (_v391Show !== _v391SkipVisibleRef.current) {
          _v391SkipVisibleRef.current = _v391Show;
          setV391SkipVisible(_v391Show);
        }
      } else if (_v391SkipVisibleRef.current) {
        _v391SkipVisibleRef.current = false;
        setV391SkipVisible(false);
      }
'@
$new = @'
      if (contentType === 'series' && playbackStarted && !_v391DoneRef.current) {
        const _v391Pos = status.positionMillis || 0;
        const _v391Show = _v391Pos >= 15000 && _v391Pos <= 300000
          && !(parsedResumePosition && parsedResumePosition * 1000 >= 240000);
        /* V393_REMOTE_DEBUG - report each state bucket once */
        const _v393B = 'show=' + String(_v391Show) + ' b=' + Math.floor(_v391Pos / 30000);
        if (_v393B !== _v393LastRef.current) {
          _v393LastRef.current = _v393B;
          _v393Log('skipintro type=' + String(contentType) + ' started=' + String(playbackStarted)
            + ' pos=' + Math.round(_v391Pos / 1000) + 's resume=' + String(parsedResumePosition)
            + ' done=' + String(_v391DoneRef.current) + ' show=' + String(_v391Show));
        }
        if (_v391Show !== _v391SkipVisibleRef.current) {
          _v391SkipVisibleRef.current = _v391Show;
          setV391SkipVisible(_v391Show);
        }
      } else if (_v391SkipVisibleRef.current) {
        _v391SkipVisibleRef.current = false;
        setV391SkipVisible(false);
        _v393Log('skipintro forced-hide started=' + String(playbackStarted) + ' done=' + String(_v391DoneRef.current));
      } else if (_v393LastRef.current !== 'blocked' && (status.positionMillis || 0) > 20000 && (status.positionMillis || 0) < 300000 && !_v391DoneRef.current) {
        _v393LastRef.current = 'blocked';
        _v393Log('skipintro BLOCKED type=' + String(contentType) + ' started=' + String(playbackStarted)
          + ' done=' + String(_v391DoneRef.current) + ' pos=' + Math.round((status.positionMillis || 0) / 1000)
          + 's resume=' + String(parsedResumePosition));
      }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: state machine instrumented" -ForegroundColor Green

# --- 3: log the button press ---
$old = @'
    console.log('[V392] Skip Intro pressed: +85s');
'@
$new = @'
    console.log('[V392] Skip Intro pressed: +85s');
    _v393Log('skipintro PRESSED'); /* V393_REMOTE_DEBUG */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] 3: press logging - player.tsx written" -ForegroundColor Green
Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch app twice, play a FRESH episode" -ForegroundColor Cyan
Write-Host "past 30 seconds - then just tell the agent. No adb needed." -ForegroundColor Cyan
Write-Host ""
