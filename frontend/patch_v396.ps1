# ============================================================================
# patch_v396.ps1 - adaptive per-show Skip Intro length (OTA)
#
# 85s was a fixed guess and cuts into episodes with short intros. Now:
#   1. Default skip drops to 60s.
#   2. The skip length is LEARNED PER SERIES: if you correct the skip
#      within 30s (rewind because it overshot / fast-forward because it
#      undershot), the correction is saved for that show (clamped 20-180s).
#      Next episode of the same series lands right where the intro ends.
#      Corrections settle 8s after your last seek press.
#
# REQUIRES: v395 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V396 Adaptive Skip Intro" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V396_ADAPTIVE_SKIP')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V395_SKIP_PRESS')) {
  Write-Host "[FATAL] V395 not applied - run patch_v395.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: per-series length store + correction learner ---
$old = @'
  const _v395CtrlRef = useRef(true); /* V395_SKIP_PRESS */
  useEffect(() => { _v395CtrlRef.current = showControls; }, [showControls]);
'@
$new = @'
  const _v395CtrlRef = useRef(true); /* V395_SKIP_PRESS */
  useEffect(() => { _v395CtrlRef.current = showControls; }, [showControls]);
  /* V396_ADAPTIVE_SKIP - per-series learned intro length. Default 60s;
     corrections (seeks within 30s of skipping) adjust and persist it. */
  const _v396LenRef = useRef(60000);
  const _v396SkipAtRef = useRef(0);
  const _v396AdjRef = useRef(0);
  const _v396TimerRef = useRef<any>(null);
  useEffect(() => {
    (async () => {
      try {
        if (!seriesId) return;
        const raw = await AsyncStorage.getItem('@ps_intro_len');
        const map = raw ? JSON.parse(raw) : {};
        const v = map[String(seriesId)];
        if (typeof v === 'number' && v >= 20000 && v <= 180000) {
          _v396LenRef.current = v;
          console.log('[V396] intro len for ' + seriesId + ' = ' + Math.round(v / 1000) + 's');
        }
      } catch (_) {}
    })();
  }, [seriesId]);
  const _v396NoteSeek = (deltaMs: number) => {
    /* only seeks shortly after a skip count as corrections */
    if (!_v396SkipAtRef.current || Date.now() - _v396SkipAtRef.current > 30000) return;
    _v396AdjRef.current += deltaMs;
    if (_v396TimerRef.current) clearTimeout(_v396TimerRef.current);
    _v396TimerRef.current = setTimeout(async () => {
      const adj = _v396AdjRef.current;
      _v396SkipAtRef.current = 0;
      _v396AdjRef.current = 0;
      if (!adj || !seriesId) return;
      const newLen = Math.max(20000, Math.min(180000, _v396LenRef.current + adj));
      if (newLen === _v396LenRef.current) return;
      _v396LenRef.current = newLen;
      try {
        const raw = await AsyncStorage.getItem('@ps_intro_len');
        const map = raw ? JSON.parse(raw) : {};
        map[String(seriesId)] = newLen;
        await AsyncStorage.setItem('@ps_intro_len', JSON.stringify(map));
        console.log('[V396] learned intro len for ' + seriesId + ' = ' + Math.round(newLen / 1000) + 's');
      } catch (_) {}
    }, 8000);
  };
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: learner" -ForegroundColor Green

# --- 2: skip uses the learned length + arms the correction window ---
$old = @'
      const _np = Math.min(
        (durationRef.current || Number.MAX_SAFE_INTEGER) - 1000,
        positionRef.current + 85000
      );
'@
$new = @'
      _v396SkipAtRef.current = Date.now(); /* V396_ADAPTIVE_SKIP */
      _v396AdjRef.current = 0;
      const _np = Math.min(
        (durationRef.current || Number.MAX_SAFE_INTEGER) - 1000,
        positionRef.current + _v396LenRef.current
      );
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: dynamic length" -ForegroundColor Green

# --- 3-6: correction hooks on all four seek paths ---
$old = @'
          console.log('[TV] Rewind -10s from', positionRef.current);
'@
$new = @'
          console.log('[TV] Rewind -10s from', positionRef.current);
          _v396NoteSeek(-10000); /* V396 */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)

$old = @'
          console.log('[TV] FastForward +10s from', positionRef.current);
'@
$new = @'
          console.log('[TV] FastForward +10s from', positionRef.current);
          _v396NoteSeek(10000); /* V396 */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 4 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)

$old = @'
            console.log('[TV] Seek Left -10s (progress bar focused)');
'@
$new = @'
            console.log('[TV] Seek Left -10s (progress bar focused)');
            _v396NoteSeek(-10000); /* V396 */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 5 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)

$old = @'
            console.log('[TV] Seek Right +10s (progress bar focused)');
'@
$new = @'
            console.log('[TV] Seek Right +10s (progress bar focused)');
            _v396NoteSeek(10000); /* V396 */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 6 missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3-6: correction hooks" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host ""
Write-Host "[DONE] player.tsx written. deploy_ota.bat + force-close cycle." -ForegroundColor Green
Write-Host ""
