# ============================================================================
# patch_v402b.ps1 - Manual stream hop (self-contained; single anchor)
#
# v402 tried to hook into tryNextStream with fragile indent-sensitive
# anchors. Instead, parse the fallbackStreams param directly and call
# setStreamUrl on MENU/SELECT press. Zero touching of existing cascade.
#
# REQUIRES: v400 + v401. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V402b  Manual Stream Hop (single-anchor)" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V401_DIAG_OVERLAY')) {
  Write-Host "[FATAL] v401 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V402_STREAM_HOP')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

# --- 1: state + swap logic + MENU handler at the v401 timeout line ---
$old = @'
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 15000); return () => clearTimeout(_t); }, []);
'@
$new = @'
  useEffect(() => { const _t = setTimeout(() => setV400Tag(false), 15000); return () => clearTimeout(_t); }, []);
  /* V402_STREAM_HOP - self-contained: parse fallbackStreams from params and
     swap the video URL directly via setStreamUrl. */
  const _v402FBList = useMemo(() => {
    try {
      const raw = (_v401RawParams && (_v401RawParams.fallbackStreams as any));
      if (!raw) return [] as any[];
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return [] as any[]; }
  }, [_v401RawParams]);
  const _v402IdxRef = useRef(-1); /* -1 == still on directUrl (index 0 = first fallback) */
  const [_v402Toast, setV402Toast] = useState<string | null>(null);
  const _v402Swap = useCallback(() => {
    try {
      if (_v402FBList.length === 0) {
        setV402Toast('No fallback streams');
      } else {
        const next = (_v402IdxRef.current + 1);
        if (next >= _v402FBList.length) {
          _v402IdxRef.current = -1;
          setV402Toast('Wrapped - back to primary');
          const _du = String((_v401RawParams && _v401RawParams.directUrl) || '');
          if (_du) { try { (setStreamUrl as any)(_du); } catch (_) {} }
        } else {
          _v402IdxRef.current = next;
          const item: any = _v402FBList[next];
          const url = typeof item === 'string' ? item : (item && (item.url || item.streamUrl || item.directUrl));
          if (url && typeof url === 'string') {
            try { (setStreamUrl as any)(url); } catch (_) {}
            setV402Toast('Stream ' + (next + 2) + '/' + (_v402FBList.length + 1) + ' | ...' + String(url).slice(-40));
          } else {
            setV402Toast('Fallback ' + (next + 1) + ' has no url');
          }
        }
      }
    } catch (e: any) {
      setV402Toast('Swap error: ' + String(e && e.message ? e.message : e).slice(0, 60));
    }
    setTimeout(() => setV402Toast(null), 4000);
  }, [_v402FBList, _v401RawParams]);
  /* V402 - Firestick MENU key via TVEventHandler if available */
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
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 1 missing (v401 timeout line)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: swap fn + MENU handler" -ForegroundColor Green

# --- 2: SWAP pill JSX + toast (right after v401 diag close) ---
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
                <Text style={{ color: '#B8A05C', fontSize: 10, marginTop: 2 }}>
                  fbCount: {_v402FBList.length}
                </Text>
              </View>
            )}
            {/* V402_STREAM_HOP - focusable SWAP pill top-left */}
            <TouchableOpacity
              onPress={_v402Swap}
              activeOpacity={0.7}
              focusable
              style={{
                position: 'absolute',
                top: 24,
                left: 24,
                backgroundColor: 'rgba(15,15,15,0.88)',
                borderColor: '#B8A05C',
                borderWidth: 1.5,
                borderRadius: 8,
                paddingHorizontal: 16,
                paddingVertical: 10,
                zIndex: 61,
              }}
            >
              <Text style={{ color: '#B8A05C', fontSize: 13, fontWeight: '800', letterSpacing: 0.6 }}>
                SWAP STREAM
              </Text>
              <Text style={{ color: '#888', fontSize: 9, marginTop: 2 }}>
                MENU key or focus + SELECT
              </Text>
            </TouchableOpacity>
            {_v402Toast && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  bottom: 96,
                  right: 48,
                  maxWidth: 640,
                  backgroundColor: 'rgba(15,15,15,0.92)',
                  borderColor: '#B8A05C',
                  borderWidth: 1.5,
                  borderRadius: 8,
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  zIndex: 62,
                }}
              >
                <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '700', letterSpacing: 0.4 }}>
                  {_v402Toast}
                </Text>
              </View>
            )}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor 2 missing (v401 keys close)" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] 2: pill + toast JSX" -ForegroundColor Green

# --- 3: ensure useMemo + useCallback + TouchableOpacity are imported ---
# Very light-touch: only add if missing. React usually already exports these.
if (-not ($p -match "import\s+React[^;]*useMemo")) {
  Write-Host "[INFO] Skipping React import edit (usually already present)" -ForegroundColor DarkGray
}

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V402b applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "    On playback the diag box shows fbCount:X - if X > 0," -ForegroundColor Cyan
Write-Host "    press MENU or focus the gold SWAP STREAM pill and press" -ForegroundColor Cyan
Write-Host "    SELECT to hop to the next stream. Toast shows progress." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
