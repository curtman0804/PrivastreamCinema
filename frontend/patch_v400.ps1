# ============================================================================
# patch_v400.ps1 - HARD English guard + Kill Skip Intro (OTA)
#
# WHY:
#   v398b sorted foreign to the back of `parsed`, but the play flow uses
#   .find(p => p.stream.url) which walks past English UNCACHED entries (no
#   URL) and lands on the first foreign CACHED entry. That's why South Park
#   still played German/Russian even after v398b applied.
#
# FIX:
#   1) In [id].tsx: if ANY English stream exists in `parsed`, do not push
#      foreign into `parsed` at all. Foreign is only appended when the
#      English pool is completely empty. Kills the .find fall-through.
#   2) In player.tsx: kill the Skip Intro pill and auto-skip trigger. Code
#      stays in place (v396/v399 refs remain), just gated to never fire.
#   3) In player.tsx: transient V400 build tag toast on mount so on-device
#      we can confirm the build without needing findstr on the PC.
#
# REQUIRES: v398b + v399 applied. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V400  English HARD guard + Skip kill" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# 1) [id].tsx - drop foreign from parsed when English exists
# ---------------------------------------------------------------------------
$idPath = 'app\details\[type]\[id].tsx'
if (!(Test-Path -LiteralPath $idPath)) { Write-Host "[FATAL] $idPath not found" -ForegroundColor Red; exit 1 }
$idAbs = (Resolve-Path -LiteralPath $idPath).Path
$id = [System.IO.File]::ReadAllText($idAbs)

if (-not $id.Contains('V398_ENGLISH_WALL')) {
  Write-Host "[FATAL] v398b not applied - run patch_v398b.ps1 first" -ForegroundColor Red
  exit 1
}

if ($id.Contains('V400_ENGLISH_HARD_GUARD')) {
  Write-Host "[SKIP] id.tsx already patched" -ForegroundColor Yellow
} else {
  $old = @'
    _v398f_c.sort(_v357_sortScore);
    _v398f_u.sort(_v357_sortScore);
    for (const p of _v398f_c) parsed.push(p);
    for (const p of _v398f_u) parsed.push(p);
    console.log('[V398 ENGLISH WALL] eng=' + _v398eng.length + ' foreign=' + _v398for.length);
'@
  $new = @'
    _v398f_c.sort(_v357_sortScore);
    _v398f_u.sort(_v357_sortScore);
    /* V400_ENGLISH_HARD_GUARD - v398b left foreign at the tail of `parsed`,
       but the play flow uses .find(p => p.stream.url) which walks past
       English UNCACHED entries (no URL) and lands on the first foreign
       CACHED entry. Result: German/Russian still auto-played whenever
       there was no English cached release. Fix: when ANY English stream
       exists, drop foreign from `parsed` entirely. Foreign is only
       appended when the English pool is completely empty. */
    if (_v398eng.length === 0) {
      for (const p of _v398f_c) parsed.push(p);
      for (const p of _v398f_u) parsed.push(p);
      console.log('[V400] NO ENGLISH - falling back to foreign (' + (_v398f_c.length + _v398f_u.length) + ')');
    } else {
      console.log('[V400] English exists (' + _v398eng.length + ') - foreign hidden (' + (_v398f_c.length + _v398f_u.length) + ')');
    }
    console.log('[V398 ENGLISH WALL] eng=' + _v398eng.length + ' foreign=' + _v398for.length);
'@
  if (-not $id.Contains($old)) {
    Write-Host "[FATAL] id.tsx anchor missing (v398b foreign push tail)" -ForegroundColor Red
    Write-Host "Run and send me:" -ForegroundColor Yellow
    Write-Host '  findstr /N /C:"V398 ENGLISH WALL" "app\details\[type]\[id].tsx"' -ForegroundColor Yellow
    exit 1
  }
  $id = $id.Replace($old, $new)
  [System.IO.File]::WriteAllText($idAbs, $id)
  Write-Host "[OK] id.tsx: foreign hidden when English exists" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# 2) player.tsx - kill Skip Intro pill + auto-skip + add V400 build tag
# ---------------------------------------------------------------------------
$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V399_AUTO_SKIP')) {
  Write-Host "[FATAL] v399 not applied - run patch_v399.ps1 first" -ForegroundColor Red
  exit 1
}

# --- 2a: kill the pill (force _v391Show = false) ---
if ($p.Contains('V400_SKIP_KILL')) {
  Write-Host "[SKIP] player.tsx pill kill already patched" -ForegroundColor Yellow
} else {
  $old = @'
        const _v391Show = _v399StartRef.current === null && _v391Pos >= 15000 && _v391Pos <= 120000 /* V399 - learned series auto-skip instead */
'@
  $new = @'
        const _v391Show = false; /* V400_SKIP_KILL - Skip Intro disabled entirely (v396/v399 dormant) */ // was: _v399StartRef.current === null && _v391Pos >= 15000 && _v391Pos <= 120000
'@
  if (-not $p.Contains($old)) {
    Write-Host "[FATAL] player.tsx pill anchor missing (v399 _v391Show line)" -ForegroundColor Red
    exit 1
  }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] player.tsx: Skip Intro pill disabled" -ForegroundColor Green
}

# --- 2b: kill the v399 auto-skip trigger ---
if ($p.Contains('V400_AUTOSKIP_KILL')) {
  Write-Host "[SKIP] player.tsx autoskip kill already patched" -ForegroundColor Yellow
} else {
  $old = @'
        if (_v399StartRef.current !== null && !_v399AutoDoneRef.current
            && _v391Pos >= _v399StartRef.current
            && _v391Pos < _v399StartRef.current + _v396LenRef.current - 2000
            && !(parsedResumePosition && parsedResumePosition * 1000 > _v399StartRef.current + 5000)) {
          _v399AutoDoneRef.current = true;
          _v399AutoSkip();
        }
'@
  $new = @'
        /* V400_AUTOSKIP_KILL - auto-skip disabled. v399 refs still load and
           save so re-enabling later needs no data migration. */
        if (false && _v399StartRef.current !== null && !_v399AutoDoneRef.current
            && _v391Pos >= _v399StartRef.current
            && _v391Pos < _v399StartRef.current + _v396LenRef.current - 2000
            && !(parsedResumePosition && parsedResumePosition * 1000 > _v399StartRef.current + 5000)) {
          _v399AutoDoneRef.current = true;
          _v399AutoSkip();
        }
'@
  if (-not $p.Contains($old)) {
    Write-Host "[FATAL] player.tsx autoskip anchor missing (v399 trigger block)" -ForegroundColor Red
    exit 1
  }
  $p = $p.Replace($old, $new)
  Write-Host "[OK] player.tsx: v399 auto-skip disabled" -ForegroundColor Green
}

# --- 2c: V400 build tag toast (sibling of v399 toast) ---
if ($p.Contains('V400_BUILD_TAG')) {
  Write-Host "[SKIP] player.tsx build tag already patched" -ForegroundColor Yellow
} else {
  # add ref + effect immediately after the v399 refs block
  $old = @'
  const [_v399Toast, setV399Toast] = useState(false);
  useEffect(() => { _v399AutoDoneRef.current = false; }, [contentId]);
'@
  $new = @'
  const [_v399Toast, setV399Toast] = useState(false);
  useEffect(() => { _v399AutoDoneRef.current = false; }, [contentId]);
  /* V400_BUILD_TAG - transient build stamp so we can see at runtime what is
     actually deployed. Shows for 4s at player mount. */
  const [_v400Tag, setV400Tag] = useState(true);
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 4000); return () => clearTimeout(_t); }, []);
'@
  if (-not $p.Contains($old)) {
    Write-Host "[FATAL] player.tsx build tag ref anchor missing (v399 toast state line)" -ForegroundColor Red
    exit 1
  }
  $p = $p.Replace($old, $new)

  # add the JSX right after the v399 "Intro Skipped" toast block
  $oldJsx = @'
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.4, marginLeft: 10 }}>
                  Intro Skipped
                </Text>
              </View>
            )}
'@
  $newJsx = @'
                <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700', letterSpacing: 0.4, marginLeft: 10 }}>
                  Intro Skipped
                </Text>
              </View>
            )}
            {/* V400_BUILD_TAG - transient build stamp */}
            {_v400Tag && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  top: 24,
                  right: 24,
                  backgroundColor: 'rgba(15,15,15,0.85)',
                  borderColor: '#4CAF50',
                  borderWidth: 1,
                  borderRadius: 6,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  zIndex: 60,
                }}
              >
                <Text style={{ color: '#4CAF50', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>
                  BUILD V400  ENG-GUARD  SKIP-OFF
                </Text>
              </View>
            )}
'@
  if (-not $p.Contains($oldJsx)) {
    Write-Host "[FATAL] player.tsx build tag JSX anchor missing (v399 toast JSX block)" -ForegroundColor Red
    exit 1
  }
  $p = $p.Replace($oldJsx, $newJsx)
  Write-Host "[OK] player.tsx: V400 build tag toast added" -ForegroundColor Green
}

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V400 applied. Verify on disk:" -ForegroundColor Cyan
Write-Host '  findstr /C:"V400_ENGLISH_HARD_GUARD" "app\details\[type]\[id].tsx"'
Write-Host '  findstr /C:"V400_SKIP_KILL"          app\player.tsx'
Write-Host '  findstr /C:"V400_BUILD_TAG"          app\player.tsx'
Write-Host "  Then run deploy_ota.bat and relaunch the app twice." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
