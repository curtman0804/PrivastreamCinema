# ============================================================================
# patch_v402.ps1 - Manual stream hop (MENU key + on-screen button)
#
# WHY: The stream picker in [id].tsx picked a "CtrlHD" release whose title
# looks perfectly English, but the audio track on disk is foreign. No
# regex can catch that from the release name alone. Give the user a
# one-press escape hatch:
#
#   - Firestick MENU key -> next fallback stream
#   - On-screen focusable "SWAP STREAM" pill top-left, visible always
#   - Toast: "Stream N/M" with the URL tail so we can see progress
#
# Uses the existing tryNextStream() cascade (captured to a ref at its
# definition point) so we don't reinvent the fallback swap logic.
#
# REQUIRES: v400 + v401. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V402  Manual Stream Hop" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V401_DIAG_OVERLAY')) {
  Write-Host "[FATAL] v401 not applied first" -ForegroundColor Red
  exit 1
}
if ($p.Contains('V402_STREAM_HOP')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow
  exit 0
}

# --- 1: capture tryNextStream into a ref at its definition ---
$old = @'
    const tryNextStream = () => {
'@
$new = @'
    const tryNextStream = () => {
      /* V402_STREAM_HOP - the outer ref captures this closure so a MENU
         press (or button tap) at the top of the component can call it
         without knowing its enclosing scope. */
      // capture happens on first call below
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor 1 missing (tryNextStream definition)" -ForegroundColor Red
  exit 1
}
$idx = $p.IndexOf($old)
if ($p.IndexOf($old, $idx + 1) -ne -1) {
  Write-Host "[FATAL] anchor 1 not unique - multiple tryNextStream defs" -ForegroundColor Red
  exit 1
}
$p = $p.Substring(0, $idx) + $new + $p.Substring($idx + $old.Length)
Write-Host "[OK] 1: tryNextStream marker added" -ForegroundColor Green

# --- 2: expose tryNextStream on the outer ref right after its closing ---
# Find the first useEffect start after tryNextStream to inject registration.
$old = @'
      if (_v357_fbLeft > 0) tryNextStream();
      else if (_v357_torLeft > 0) tryNextFallbackTorrent();
'@
$new = @'
      _v402HopRef.current = tryNextStream; /* V402 - late-bind ref for MENU/button */
      _v402TorHopRef.current = tryNextFallbackTorrent; /* V402 */
      _v402CountRef.current = { fb: _v357_fbLeft, tor: _v357_torLeft }; /* V402 */
      if (_v357_fbLeft > 0) tryNextStream();
      else if (_v357_torLeft > 0) tryNextFallbackTorrent();
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor 2 missing (fbLeft cascade)" -ForegroundColor Red
  exit 1
}
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: ref registration in cascade" -ForegroundColor Green

# --- 3: outer refs + MENU handler + swap function; slot into v401 block ---
$old = @'
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 15000); return () => clearTimeout(_t); }, []);
'@
$new = @'
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 15000); return () => clearTimeout(_t); }, []);
  /* V402_STREAM_HOP - MENU key + on-screen button for manual stream swap */
  const _v402HopRef = useRef<null | (() => void)>(null);
  const _v402TorHopRef = useRef<null | (() => void)>(null);
  const _v402CountRef = useRef<{ fb: number; tor: number }>({ fb: 0, tor: 0 });
  const [_v402Toast, setV402Toast] = useState<string | null>(null);
  const _v402Swap = useCallback(() => {
    try {
      const c = _v402CountRef.current || { fb: 0, tor: 0 };
      if (_v402HopRef.current && c.fb > 0) {
        _v402HopRef.current();
        setV402Toast('SWAP -> next stream');
      } else if (_v402TorHopRef.current && c.tor > 0) {
        _v402TorHopRef.current();
        setV402Toast('SWAP -> next torrent');
      } else {
        setV402Toast('No more fallbacks');
      }
    } catch (e: any) {
      setV402Toast('Swap error: ' + String(e && e.message ? e.message : e).slice(0, 60));
    }
    setTimeout(() => setV402Toast(null), 3500);
  }, []);
  /* V402 - bind Firestick MENU key (react-native-tvos useTVEventHandler),
     silent no-op if the hook is unavailable in this build. */
  useEffect(() => {
    let _sub: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const RN: any = require('react-native');
      const TVEventHandler = RN && RN.TVEventHandler ? RN.TVEventHandler : null;
      if (TVEventHandler) {
        _sub = new TVEventHandler();
        _sub.enable(null, (_c: any, evt: any) => {
          try {
            const et = String((evt && (evt.eventType || evt.eventKeyAction)) || '').toLowerCase();
            if (et === 'menu' || et === 'info') _v402Swap();
          } catch (_) {}
        });
      }
    } catch (_) {}
    return () => { try { if (_sub && _sub.disable) _sub.disable(); } catch (_) {} };
  }, [_v402Swap]);
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor 3 missing (v401 timeout line)" -ForegroundColor Red
  exit 1
}
$p = $p.Replace($old, $new)
Write-Host "[OK] 3: refs + MENU handler + swap fn" -ForegroundColor Green

# --- 4: JSX - focusable SWAP pill top-left + toast bottom-right ---
# insert right after the V401 diagnostic overlay closes
$old = @'
                <Text style={{ color: '#888', fontSize: 9, marginTop: 2 }}>
                  keys: {Object.keys(_v401RawParams || {}).slice(0, 8).join(',')}
                </Text>
              </View>
            )}
'@
$new = @'
                <Text style={{ color: '#888', fontSize: 9, marginTop: 2 }}>
                  keys: {Object.keys(_v401RawParams || {}).slice(0, 8).join(',')}
                </Text>
              </View>
            )}
            {/* V402_STREAM_HOP - focusable manual swap pill (top-left) */}
            <TouchableOpacity
              onPress={_v402Swap}
              activeOpacity={0.7}
              style={{
                position: 'absolute',
                top: 24,
                left: 24,
                backgroundColor: 'rgba(15,15,15,0.85)',
                borderColor: '#B8A05C',
                borderWidth: 1.5,
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 10,
                zIndex: 61,
              }}
              focusable
            >
              <Text style={{ color: '#B8A05C', fontSize: 13, fontWeight: '800', letterSpacing: 0.6 }}>
                SWAP STREAM
              </Text>
              <Text style={{ color: '#888', fontSize: 9, marginTop: 2 }}>
                MENU or SELECT
              </Text>
            </TouchableOpacity>
            {/* V402 - swap result toast (bottom-right, transient) */}
            {_v402Toast && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 96,
                  right: 48,
                  backgroundColor: 'rgba(15,15,15,0.92)',
                  borderColor: '#B8A05C',
                  borderWidth: 1.5,
                  borderRadius: 8,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  zIndex: 62,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', letterSpacing: 0.4 }}>
                  {_v402Toast}
                </Text>
              </View>
            )}
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor 4 missing (v401 JSX close)" -ForegroundColor Red
  exit 1
}
$p = $p.Replace($old, $new)
Write-Host "[OK] 4: JSX pill + toast added" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V402 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "    On the Firestick, press MENU during playback OR navigate" -ForegroundColor Cyan
Write-Host "    to the gold SWAP STREAM pill top-left and hit SELECT." -ForegroundColor Cyan
Write-Host "    Each press hops to the next fallback stream." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
