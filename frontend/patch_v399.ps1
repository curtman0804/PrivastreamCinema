# ============================================================================
# patch_v399.ps1 - SELF-AWARE Skip Intro: auto-skips once learned (OTA)
#
# The pill required a press every episode and had no idea where the intro
# actually was. Now:
#   1. The FIRST time you press Skip Intro on a series, the app records
#      WHERE the intro starts (your press position minus 3s reaction time)
#      alongside the learned length.
#   2. Every later episode of that series: the moment playback enters the
#      learned intro window the app skips it AUTOMATICALLY - no press, no
#      pill. A small "Intro Skipped" toast shows for 3.5s.
#   3. If the auto-skip lands wrong, rewind/fast-forward within 30s and the
#      correction is learned exactly like v396 (settles 8s after last press).
#   4. The pill only ever shows on series the app hasn't learned yet.
#   5. Resuming an episode past the intro never triggers an auto-skip.
#
# Storage: @ps_intro_len entries upgrade from plain number (length) to
# { s: startMs, l: lengthMs }. Old numeric entries still load fine.
#
# REQUIRES: v396 applied.
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V399 Self-Aware Skip Intro" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V399_AUTO_SKIP')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}
if (-not $p.Contains('V396_ADAPTIVE_SKIP')) {
  Write-Host "[FATAL] V396 not applied - run patch_v396.ps1 first!" -ForegroundColor Red
  exit 1
}

# --- 1: refs + persist + auto-skip action (after the v396 learner) ---
$old = @'
    }, 8000);
  };
'@
$new = @'
    }, 8000);
  };
  /* V399_AUTO_SKIP - self-aware skip intro. Refs + persist + auto action. */
  const _v399StartRef = useRef<number | null>(null);
  const _v399AutoDoneRef = useRef(false);
  const [_v399Toast, setV399Toast] = useState(false);
  useEffect(() => { _v399AutoDoneRef.current = false; }, [contentId]);
  const _v399Persist = () => {
    (async () => {
      try {
        if (!seriesId) return;
        const raw = await AsyncStorage.getItem('@ps_intro_len');
        const map = raw ? JSON.parse(raw) : {};
        map[String(seriesId)] = { s: _v399StartRef.current, l: _v396LenRef.current };
        await AsyncStorage.setItem('@ps_intro_len', JSON.stringify(map));
        console.log('[V399] saved intro start=' + String(_v399StartRef.current) + ' len=' + _v396LenRef.current + ' for ' + seriesId);
      } catch (_) {}
    })();
  };
  const _v399AutoSkip = () => {
    try {
      _v391DoneRef.current = true;
      _v391SkipVisibleRef.current = false;
      setV391SkipVisible(false);
      _v396SkipAtRef.current = Date.now(); /* corrections still learn */
      _v396AdjRef.current = 0;
      const _end = (_v399StartRef.current || 0) + _v396LenRef.current;
      const _np = Math.min((durationRef.current || Number.MAX_SAFE_INTEGER) - 1000, _end);
      if (videoRef.current) videoRef.current.setPositionAsync(Math.max(0, _np));
      console.log('[V399] AUTO-SKIP intro to ' + Math.round(_np / 1000) + 's');
      _v393Log('v399 AUTO-SKIP to ' + Math.round(_np / 1000) + 's');
      setV399Toast(true);
      setTimeout(() => setV399Toast(false), 3500);
    } catch (_) {}
  };
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing (v396 learner tail)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: refs + auto-skip action" -ForegroundColor Green

# --- 2: load learned intro START alongside length ---
$old = @'
        const v = map[String(seriesId)];
        if (typeof v === 'number' && v >= 20000 && v <= 180000) {
          _v396LenRef.current = v;
          console.log('[V396] intro len for ' + seriesId + ' = ' + Math.round(v / 1000) + 's');
        }
'@
$new = @'
        const v = map[String(seriesId)];
        /* V399 - entries upgraded to { s: startMs, l: lengthMs }; legacy
           plain-number entries (length only) still load. */
        const _v399L = (v && typeof v === 'object') ? (v as any).l : v;
        const _v399S = (v && typeof v === 'object') ? (v as any).s : null;
        if (typeof _v399L === 'number' && _v399L >= 20000 && _v399L <= 180000) {
          _v396LenRef.current = _v399L;
          console.log('[V396] intro len for ' + seriesId + ' = ' + Math.round(_v399L / 1000) + 's');
        }
        if (typeof _v399S === 'number' && _v399S >= 0 && _v399S <= 300000) {
          _v399StartRef.current = _v399S;
          console.log('[V399] intro start for ' + seriesId + ' = ' + Math.round(_v399S / 1000) + 's');
        }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing (v396 load block)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: start loaded with length" -ForegroundColor Green

# --- 3: learner persists { s, l } instead of bare length ---
$old = @'
        map[String(seriesId)] = newLen;
'@
$new = @'
        map[String(seriesId)] = { s: _v399StartRef.current, l: newLen }; /* V399 */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing (learner persist)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: learner persists start+len" -ForegroundColor Green

# --- 4: manual press records the intro START ---
$old = @'
      _v396SkipAtRef.current = Date.now(); /* V396_ADAPTIVE_SKIP */
      _v396AdjRef.current = 0;
'@
$new = @'
      _v399StartRef.current = Math.max(0, positionRef.current - 3000); /* V399 - learn intro start (minus press reaction time) */
      _v399Persist();
      _v396SkipAtRef.current = Date.now(); /* V396_ADAPTIVE_SKIP */
      _v396AdjRef.current = 0;
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 4 missing (v396 skip press)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 4: press learns intro start" -ForegroundColor Green

# --- 5: auto-skip trigger in the playback status handler ---
$old = @'
      if (contentType === 'series' && playbackStarted && !_v391DoneRef.current) {
        const _v391Pos = status.positionMillis || 0;
'@
$new = @'
      if (contentType === 'series' && playbackStarted && !_v391DoneRef.current) {
        const _v391Pos = status.positionMillis || 0;
        /* V399_AUTO_SKIP - once this series' intro window is learned, skip
           it automatically the moment playback enters it. Never fires when
           resuming past the intro start. */
        if (_v399StartRef.current !== null && !_v399AutoDoneRef.current
            && _v391Pos >= _v399StartRef.current
            && _v391Pos < _v399StartRef.current + _v396LenRef.current - 2000
            && !(parsedResumePosition && parsedResumePosition * 1000 > _v399StartRef.current + 5000)) {
          _v399AutoDoneRef.current = true;
          _v399AutoSkip();
        }
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 5 missing (v391 status block)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 5: auto-skip trigger" -ForegroundColor Green

# --- 6: pill only shows on series not yet learned ---
$old = @'
        const _v391Show = _v391Pos >= 15000 && _v391Pos <= 120000
'@
$new = @'
        const _v391Show = _v399StartRef.current === null && _v391Pos >= 15000 && _v391Pos <= 120000 /* V399 - learned series auto-skip instead */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 6 missing (pill window)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 6: pill hidden once learned" -ForegroundColor Green

# --- 7: "Intro Skipped" toast UI ---
$old = @'
            {/* V392_SKIP_INTRO_BUTTON - focusable card like the Up Next
'@
$new = @'
            {/* V399_AUTO_SKIP - transient confirmation toast */}
            {_v399Toast && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 96,
                  right: 48,
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: 'rgba(15,15,15,0.92)',
                  borderColor: '#B8A05C',
                  borderWidth: 1.5,
                  borderRadius: 8,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  zIndex: 60,
                }}
              >
                <Ionicons name="play-skip-forward" size={16} color="#B8A05C" />
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.4, marginLeft: 10 }}>
                  Intro Skipped
                </Text>
              </View>
            )}
            {/* V392_SKIP_INTRO_BUTTON - focusable card like the Up Next
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 7 missing (V392 pill JSX)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 7: toast UI" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V399 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V399_AUTO_SKIP" app\player.tsx'
Write-Host "  Then run deploy_ota.bat" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
