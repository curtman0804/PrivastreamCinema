# ============================================================================
# patch_v401.ps1 - Diagnostic overlay: what stream is the player actually
# picking? V400 stopped the bundler crash and killed Skip Intro, but foreign
# audio is still playing, meaning either my detector isn't tagging South
# Park's stream OR the play flow bypasses `parsed` entirely.
#
# This patch replaces the V400 build-tag toast with a 4-line diagnostic:
#   BUILD V401
#   T: <first 68 chars of stream title/name>
#   U: ...<last 44 chars of streamUrl>
#   FOREIGN: yes/no (v398 detector run on the title above)
#
# Stays on-screen 15s. Also dumps the same 4 lines to the backend devlog so
# we don't need adb.
#
# REQUIRES: v400 + v400b applied. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V401  On-screen stream diagnostic" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V400_BUILD_TAG')) {
  Write-Host "[FATAL] v400 not applied - run patch_v400.ps1 first" -ForegroundColor Red
  exit 1
}

if ($p.Contains('V401_DIAG_OVERLAY')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

# --- 1: swap the 4s timeout to 15s and wire diag state ---
$old = @'
  /* V400_BUILD_TAG - transient build stamp so we can see at runtime what is
     actually deployed. Shows for 4s at player mount. */
  const [_v400Tag, setV400Tag] = useState(true);
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 4000); return () => clearTimeout(_t); }, []);
'@
$new = @'
  /* V401_DIAG_OVERLAY - upgraded V400 tag: show what the player actually
     picked so we can see whether the detector misses this title or the
     player bypasses `parsed` entirely. Stays 15s. */
  const [_v400Tag, setV400Tag] = useState(true);
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 15000); return () => clearTimeout(_t); }, []);
  const _v401RawParams = useLocalSearchParams() as any;
  const _v401Title = String((_v401RawParams && (_v401RawParams.streamTitle || _v401RawParams.title || _v401RawParams.name || _v401RawParams.contentTitle)) || '');
  const _v401UrlSrc = String((typeof streamUrl === 'string' ? streamUrl : '') || (_v401RawParams && (_v401RawParams.url || _v401RawParams.streamUrl)) || '');
  const _v401IsForeign = (() => {
    try {
      const _raw = _v401Title;
      if (/[\u0400-\u04FF]/.test(_raw)) return true;
      if (/[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/.test(_raw)) return true;
      const _fl = _raw.match(/\uD83C[\uDDE6-\uDDFF]\uD83C[\uDDE6-\uDDFF]/g) || [];
      const _engFl = ['\uD83C\uDDEC\uD83C\uDDE7', '\uD83C\uDDFA\uD83C\uDDF8', '\uD83C\uDDE8\uD83C\uDDE6', '\uD83C\uDDE6\uD83C\uDDFA', '\uD83C\uDDF3\uD83C\uDDFF', '\uD83C\uDDEE\uD83C\uDDEA'];
      for (let _i = 0; _i < _fl.length; _i++) { if (_engFl.indexOf(_fl[_i]) === -1) return true; }
      const _u = _raw.toUpperCase().replace(/MULTI[\s.\-]?SUBS?/g, '');
      if (/\bVOSTFR\b|\bVOSTA\b|\bVFF\b|\bVFQ\b|\bTRUEFRENCH\b|\bFRENCH\b|\bFRA\b/.test(_u)) return true;
      if (/\bGERMAN\b|\bDEUTSCH\b|\bGER\b|\bDEU\b/.test(_u)) return true;
      if (/\bITALIAN\b|\bITALIANO\b|\bITA\b/.test(_u)) return true;
      if (/\bSPANISH\b|\bESPANOL\b|\bCASTELLANO\b|\bLATINO\b/.test(_u)) return true;
      if (/\bRUSSIAN\b|\bRUS\b|\bUKRAINIAN\b|\bUKR\b/.test(_u)) return true;
      if (/\bKOREAN\b|\bKOR\b|\bJAPANESE\b|\bJPN\b|\bCHINESE\b|\bCHS\b|\bCHT\b/.test(_u)) return true;
      if (/\bPOLISH\b|\bLEKTOR\b|\bTURKISH\b|\bHINDI\b|\bTAMIL\b|\bTELUGU\b|\bDUBLADO\b|\bPORTUGUESE\b|\bDUTCH\b/.test(_u)) return true;
      if (/\bMULTI\b|\bDUAL\b|\bDUBBED\b/.test(_u)) return true;
      return false;
    } catch (_) { return false; }
  })();
  useEffect(() => {
    if (!_v401UrlSrc) return;
    const body = 'V401 T=' + _v401Title.slice(0, 200) + ' | U=' + _v401UrlSrc.slice(-120) + ' | FOREIGN=' + (_v401IsForeign ? 'YES' : 'no') + ' | PARAM_KEYS=' + Object.keys(_v401RawParams || {}).join(',');
    try {
      fetch((process.env.EXPO_PUBLIC_BACKEND_URL || '') + '/api/devlog', {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, body,
      }).catch(() => {});
    } catch (_) {}
    console.log('[V401 DIAG] ' + body);
  }, [_v401UrlSrc]);
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing (v400 tag block)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: diagnostic state added" -ForegroundColor Green

# --- 2: expand the tag JSX to show 4 lines ---
$old = @'
                <Text style={{ color: '#4CAF50', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>
                  BUILD V400  ENG-GUARD  SKIP-OFF
                </Text>
'@
$new = @'
                <Text style={{ color: '#4CAF50', fontSize: 12, fontWeight: '700', letterSpacing: 0.6 }}>
                  BUILD V401  {_v401IsForeign ? 'FOREIGN:YES' : 'FOREIGN:no'}
                </Text>
                <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '600', marginTop: 4 }}>
                  T: {(_v401Title || '(empty title)').slice(0, 68)}
                </Text>
                <Text style={{ color: '#B8A05C', fontSize: 10, fontWeight: '500', marginTop: 2 }}>
                  U: {(_v401UrlSrc ? ('...' + _v401UrlSrc.slice(-44)) : '(no url yet)')}
                </Text>
                <Text style={{ color: '#888', fontSize: 9, marginTop: 2 }}>
                  keys: {Object.keys(_v401RawParams || {}).slice(0, 8).join(',')}
                </Text>
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing (v400 tag JSX Text)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: JSX expanded" -ForegroundColor Green

# --- 3: make the pill wider to fit 4 lines ---
$old = @'
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
'@
$new = @'
                  top: 24,
                  right: 24,
                  maxWidth: 620,
                  backgroundColor: 'rgba(15,15,15,0.92)',
                  borderColor: '#4CAF50',
                  borderWidth: 1,
                  borderRadius: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  zIndex: 60,
                }}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 3 missing (v400 tag View style)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: overlay widened" -ForegroundColor Green

# --- 4: sentinel comment so we detect idempotently ---
if (-not $p.Contains('V401_DIAG_OVERLAY')) {
  $p = "// V401_DIAG_OVERLAY sentinel`n" + $p
}

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V401 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "    relaunch app twice, open South Park S1E1, hit Play." -ForegroundColor Cyan
Write-Host "    Read the 4-line green box top-right and screenshot / read to me." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
