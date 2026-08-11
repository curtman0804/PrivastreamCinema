# ============================================================================
# patch_v390.ps1 - persistent watched checkmarks + Skip Intro button (OTA)
#
# [A] CHECKMARKS DISAPPEAR: the watched set lives in MMKV now, but STALE
#     copies persist in the FS-fallback tier and legacy SQLite. If any
#     session boots on a fallback engine (or ever did), an old snapshot
#     takes over and recent marks "disappear". Fix: union-merge every tier
#     at load, write the union back, mirror every mark/unmark to the FS
#     tier, and delete the legacy copy so it can never resurrect. Marks
#     now only vanish via explicit "Mark as Unwatched".
#
# [B] SKIP INTRO: series episodes show a "Skip Intro" pill (bottom-right)
#     between 0:15 and 5:00 of playback. Pressing SELECT while controls
#     are hidden jumps +85s. Auto-hides after use / past the window; never
#     shows when resuming beyond 4 minutes.
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V390 Watched Persistence + Skip Intro" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# [A] ContentCard.tsx - watched union + mirroring
# ---------------------------------------------------------------------------
$cPath = 'src\components\ContentCard.tsx'
if (!(Test-Path -LiteralPath $cPath)) { Write-Host "[FATAL] ContentCard.tsx not found" -ForegroundColor Red; exit 1 }
$cAbs = (Resolve-Path -LiteralPath $cPath).Path
$c = [System.IO.File]::ReadAllText($cAbs)

if ($c.Contains('V390_WATCHED_UNION')) {
  Write-Host "[SKIP] ContentCard.tsx already patched" -ForegroundColor Yellow
} else {

$old = @'
async function _v172Load(): Promise<void> {
  if (_v172Loaded) return;
  _v172Loaded = true;
  try {
    const raw = await AsyncStorage.getItem(_V172_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, boolean>;
      Object.keys(obj).forEach((k) => { if (obj[k]) _v172WatchedSet.add(k); });
    }
  } catch (_) { /* best-effort */ }
  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });
}
'@
$new = @'
/* V390_WATCHED_UNION - keep the FS tier in lock-step with MMKV so an
   engine flap can never lose watched marks. */
async function _v390MirrorWatched(json: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const _FS = require('expo-file-system/legacy');
    const _dir = (_FS.documentDirectory || '') + 'kv-store/';
    try {
      const _i = await _FS.getInfoAsync(_dir);
      if (!_i.exists) await _FS.makeDirectoryAsync(_dir, { intermediates: true });
    } catch (_) { /* ignore */ }
    await _FS.writeAsStringAsync(_dir + _V172_KEY + '.kv', json);
  } catch (_) { /* ignore */ }
}

async function _v172Load(): Promise<void> {
  if (_v172Loaded) return;
  _v172Loaded = true;
  /* V390_WATCHED_UNION - the watched set lives in MMKV now, but STALE
     copies persist in the FS-fallback tier and legacy SQLite. If any
     session boots on a fallback engine, an old snapshot takes over and
     recent marks "disappear". Union-merge every tier at load, write the
     union back through the shim, mirror it to the FS tier, and delete the
     legacy copy so it can never resurrect. Marks only vanish via explicit
     Mark-as-Unwatched. */
  const _raws: Array<string | null> = [];
  try { _raws.push(await AsyncStorage.getItem(_V172_KEY)); } catch (_) { /* ignore */ }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const _FS = require('expo-file-system/legacy');
    const _p = (_FS.documentDirectory || '') + 'kv-store/' + _V172_KEY + '.kv';
    const _info = await _FS.getInfoAsync(_p);
    if (_info.exists) _raws.push(await _FS.readAsStringAsync(_p));
  } catch (_) { /* ignore */ }
  let _legacyHad = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const _RealAS = require('@react-native-async-storage/async-storage').default;
    const _l = await _RealAS.getItem(_V172_KEY);
    if (_l) { _raws.push(_l); _legacyHad = true; }
  } catch (_) { /* ignore */ }
  for (const raw of _raws) {
    if (!raw) continue;
    try {
      const obj = JSON.parse(raw) as Record<string, boolean>;
      Object.keys(obj).forEach((k) => { if (obj[k]) _v172WatchedSet.add(k); });
    } catch (_) { /* ignore */ }
  }
  console.log('[V390] watched union: ' + _v172WatchedSet.size + ' entries from ' + _raws.filter(Boolean).length + ' tiers');
  try {
    const _union: Record<string, boolean> = {};
    _v172WatchedSet.forEach((k) => { _union[k] = true; });
    const _json = JSON.stringify(_union);
    await AsyncStorage.setItem(_V172_KEY, _json);
    _v390MirrorWatched(_json);
    if (_legacyHad) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const _RealAS2 = require('@react-native-async-storage/async-storage').default;
      _RealAS2.removeItem(_V172_KEY).catch(() => {});
    }
  } catch (_) { /* best-effort */ }
  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });
}
'@
if (-not $c.Contains($old)) { Write-Host "[FATAL] A1 anchor missing" -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)
Write-Host "[OK] A1: union-merge load" -ForegroundColor Green

$old = @'
    delete obj[key];
    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));
  } catch (_) { /* best-effort -- in-memory delete still took effect */ }
'@
$new = @'
    delete obj[key];
    const _j390u = JSON.stringify(obj);
    await AsyncStorage.setItem(_V172_KEY, _j390u);
    _v390MirrorWatched(_j390u); /* V390 - unmark must reach the FS tier too */
  } catch (_) { /* best-effort -- in-memory delete still took effect */ }
'@
if (-not $c.Contains($old)) { Write-Host "[FATAL] A2 anchor missing" -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)
Write-Host "[OK] A2: unmark mirrors" -ForegroundColor Green

$old = @'
    obj[key] = true;
    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));
  } catch (_) { /* best-effort */ }
'@
$new = @'
    obj[key] = true;
    const _j390m = JSON.stringify(obj);
    await AsyncStorage.setItem(_V172_KEY, _j390m);
    _v390MirrorWatched(_j390m); /* V390 - mark reaches the FS tier too */
  } catch (_) { /* best-effort */ }
'@
if (-not $c.Contains($old)) { Write-Host "[FATAL] A3 anchor missing" -ForegroundColor Red; exit 1 }
$c = $c.Replace($old, $new)
[System.IO.File]::WriteAllText($cAbs, $c)
Write-Host "[OK] A3: mark mirrors - ContentCard.tsx written" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# [B] player.tsx - Skip Intro
# ---------------------------------------------------------------------------
$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V391_SKIP_INTRO')) {
  Write-Host "[SKIP] player.tsx already patched" -ForegroundColor Yellow
} else {

# --- B1: state + refs ---
$old = @'
  const [showControls, setShowControls] = useState(true);
'@
$new = @'
  const [showControls, setShowControls] = useState(true);
  /* V391_SKIP_INTRO - pill shown during the intro window of series eps. */
  const [_v391SkipVisible, setV391SkipVisible] = useState(false);
  const _v391SkipVisibleRef = useRef(false);
  const _v391DoneRef = useRef(false);
  const _v391ControlsVisibleRef = useRef(true);
  useEffect(() => { _v391ControlsVisibleRef.current = showControls; }, [showControls]);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] B1 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] B1: state" -ForegroundColor Green

# --- B2: visibility window in status handler ---
$old = @'
      // Credits detection - show "Up Next" popup when credits start
'@
$new = @'
      /* V391_SKIP_INTRO - visible 0:15-5:00 of series playback, once per
         episode, never when resuming past 4 minutes. */
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

      // Credits detection - show "Up Next" popup when credits start
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] B2 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] B2: visibility window" -ForegroundColor Green

# --- B3: snapshot controls-hidden state before any-key shows controls ---
$old = @'
      // Show controls on any button press
      showControlsWithTimeoutRef.current?.();
'@
$new = @'
      const _v391WasHidden = !_v391ControlsVisibleRef.current; /* V391_SKIP_INTRO */
      // Show controls on any button press
      showControlsWithTimeoutRef.current?.();
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] B3 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] B3: hidden-state snapshot" -ForegroundColor Green

# --- B4: SELECT triggers the skip when the pill is up + controls hidden ---
$old = @'
        case 'select':
        case 'up':
        case 'down':
          // D-pad events - just show controls (focus navigation handled natively)
          break;
'@
$new = @'
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
        case 'up':
        case 'down':
          // D-pad events - just show controls (focus navigation handled natively)
          break;
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] B4 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] B4: select handler" -ForegroundColor Green

# --- B5: the pill ---
$old = @'
            {/* Subtitle Overlay */}
            {currentSubtitleText && (
              <View style={styles.subtitleContainer} pointerEvents="none">
                <Text style={styles.subtitleText}>{currentSubtitleText}</Text>
              </View>
            )}
            
            {/* Custom Controls Overlay - fades in/out */}
'@
$new = @'
            {/* Subtitle Overlay */}
            {currentSubtitleText && (
              <View style={styles.subtitleContainer} pointerEvents="none">
                <Text style={styles.subtitleText}>{currentSubtitleText}</Text>
              </View>
            )}

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

            {/* Custom Controls Overlay - fades in/out */}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] B5 anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] B5: pill - player.tsx written" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch twice." -ForegroundColor Cyan
Write-Host ""
