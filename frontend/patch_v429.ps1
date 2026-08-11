# patch_v429.ps1 - Toggleable sync bar with visible focus + auto-hide
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V429  Toggleable sync bar w/ focus ring"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V429_TOGGLEABLE_SYNC')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) Add state for sync bar visibility + focus tracking
# ============================================================
$stateAnchor = "/* V427_AUTOSYNC - short-lived notice to tell the user we auto-synced. */
  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);"
$stateNew = @'
/* V427_AUTOSYNC - short-lived notice to tell the user we auto-synced. */
  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);

  /* V429_TOGGLEABLE_SYNC - user-triggered sync bar w/ auto-hide + focus. */
  const [showSyncBar, setShowSyncBar] = useState<boolean>(false);
  const [syncFocusKey, setSyncFocusKey] = useState<string | null>(null);
  const _v429HideTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const _v429ResetHideTimer = () => {
    if (_v429HideTimer.current) clearTimeout(_v429HideTimer.current);
    _v429HideTimer.current = setTimeout(() => setShowSyncBar(false), 6000);
  };
  const _v429NudgeOffset = (delta: number) => {
    setSubtitleOffset(prev => prev + delta);
    _v429ResetHideTimer();
  };
  useEffect(() => {
    if (showSyncBar) {
      _v429ResetHideTimer();
      return () => { if (_v429HideTimer.current) clearTimeout(_v429HideTimer.current); };
    }
  }, [showSyncBar]);
'@
if (-not $p.Contains($stateAnchor)) { Write-Host "[FATAL] state anchor missing"; exit 1 }
$p = $p.Replace($stateAnchor, $stateNew)

# ============================================================
# 2) Remove the always-visible V428_LIVE_SYNC_BAR
# ============================================================
$v428Start = '{/* V428_LIVE_SYNC_BAR - compact always-visible sync bar so the'
$v428End   = "</TouchableOpacity>
              </View>
            )}"
$si = $p.IndexOf($v428Start)
if ($si -ge 0) {
    # Find the terminating '} block that closes the whole conditional
    $chunk = $p.Substring($si)
    # Find last closing pattern - iterate to the correct end
    $ei = $chunk.IndexOf($v428End)
    if ($ei -ge 0) {
        $len = $ei + $v428End.Length
        $p = $p.Remove($si, $len)
        Write-Host "[OK] removed v428 always-visible sync bar"
    }
}

# ============================================================
# 3) Add a "Sync Subtitles" button inside the CC picker modal.
#    Anchored right after the picker header's close button.
# ============================================================
$pickerAnchor = @'
              <TouchableOpacity 
                onPress={() => setShowSubtitles(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
'@
$pickerNew = @'
              <TouchableOpacity 
                onPress={() => setShowSubtitles(false)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={24} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* V429_TOGGLEABLE_SYNC - Sync button opens the live sync bar */}
            {selectedSubtitle && subtitleCues.length > 0 && (
              <TouchableOpacity
                focusable
                onPress={() => { setShowSubtitles(false); setShowSyncBar(true); }}
                style={{
                  backgroundColor: '#2a3a5a',
                  padding: 12,
                  marginHorizontal: 16,
                  marginBottom: 12,
                  borderRadius: 8,
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: '#66CCFF', fontWeight: 'bold', fontSize: 15 }}>
                  Adjust Subtitle Sync
                </Text>
                <Text style={{ color: '#AAA', fontSize: 12, marginTop: 2 }}>
                  Current offset: {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                </Text>
              </TouchableOpacity>
            )}
'@
if (-not $p.Contains($pickerAnchor)) {
    Write-Host "[WARN] picker anchor not exact match - skipping sync button insert"
} else {
    $p = $p.Replace($pickerAnchor, $pickerNew)
    Write-Host "[OK] added Adjust Subtitle Sync button to picker"
}

# ============================================================
# 4) Insert the new toggleable sync bar with visible focus ring.
# ============================================================
$newBar = @'
            {/* V429_TOGGLEABLE_SYNC - user-triggered sync bar with a visible
                focus ring so D-pad position is obvious, and a Done button
                to dismiss. Auto-hides after 6s of no interaction. */}
            {showSyncBar && selectedSubtitle && subtitleCues.length > 0 && (() => {
              const _btn = (k: string, label: string, delta: number, extra?: any) => {
                const focused = syncFocusKey === k;
                return (
                  <TouchableOpacity
                    key={k}
                    focusable
                    hasTVPreferredFocus={k === 'minus1'}
                    onFocus={() => { setSyncFocusKey(k); _v429ResetHideTimer(); }}
                    onBlur={() => setSyncFocusKey(prev => prev === k ? null : prev)}
                    onPress={() => _v429NudgeOffset(delta)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8,
                      marginHorizontal: 2,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: focused ? '#66CCFF' : 'transparent',
                      backgroundColor: focused ? 'rgba(102,204,255,0.15)' : 'transparent',
                      ...extra,
                    }}
                  >
                    <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 13 }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                );
              };
              const doneFocused = syncFocusKey === 'done';
              const resetFocused = syncFocusKey === 'reset';
              return (
                <View
                  style={{
                    position: 'absolute',
                    top: 40, alignSelf: 'center',
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 8, paddingVertical: 6,
                    backgroundColor: 'rgba(0,0,0,0.9)',
                    borderRadius: 24,
                    zIndex: 30,
                    borderWidth: 1,
                    borderColor: '#333',
                  }}
                >
                  {_btn('minus5', '-5s', -5000)}
                  {_btn('minus1', '-1s', -1000)}
                  {_btn('minus01', '-0.1s', -100)}
                  <View style={{ minWidth: 60, alignItems: 'center', paddingHorizontal: 6 }}>
                    <Text style={{ color: '#66CCFF', fontWeight: 'bold', fontSize: 14 }}>
                      {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                    </Text>
                  </View>
                  {_btn('plus01', '+0.1s', 100)}
                  {_btn('plus1', '+1s', 1000)}
                  {_btn('plus5', '+5s', 5000)}
                  <TouchableOpacity
                    focusable
                    onFocus={() => { setSyncFocusKey('reset'); _v429ResetHideTimer(); }}
                    onBlur={() => setSyncFocusKey(prev => prev === 'reset' ? null : prev)}
                    onPress={() => { setSubtitleOffset(0); _v429ResetHideTimer(); }}
                    style={{
                      paddingHorizontal: 10, paddingVertical: 8,
                      marginLeft: 6,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: resetFocused ? '#FFCC66' : 'transparent',
                      backgroundColor: resetFocused ? 'rgba(255,204,102,0.15)' : 'transparent',
                    }}
                  >
                    <Text style={{ color: '#FFCC66', fontSize: 12 }}>Reset</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    focusable
                    onFocus={() => { setSyncFocusKey('done'); _v429ResetHideTimer(); }}
                    onBlur={() => setSyncFocusKey(prev => prev === 'done' ? null : prev)}
                    onPress={() => setShowSyncBar(false)}
                    style={{
                      paddingHorizontal: 12, paddingVertical: 8,
                      marginLeft: 6,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: doneFocused ? '#66FF66' : 'transparent',
                      backgroundColor: doneFocused ? 'rgba(102,255,102,0.2)' : 'rgba(0,120,0,0.6)',
                    }}
                  >
                    <Text style={{ color: '#FFF', fontWeight: 'bold', fontSize: 13 }}>Done</Text>
                  </TouchableOpacity>
                </View>
              );
            })()}

'@

$anchorLast = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'
if (-not $p.Contains($anchorLast)) { Write-Host "[FATAL] anchor last missing"; exit 1 }
$p = $p.Replace($anchorLast, $newBar + '            {/* V416_STAMP - visible boot pill so we can confirm the OTA')

# Bump stamp
$p = $p.Replace("OTA v428", "OTA v429")
$p = $p.Replace("OTA v427", "OTA v429")

# Make sure React is imported (for React.useRef)
if (-not $p.Contains("import React")) {
    $p = "import React from 'react';`n" + $p
}

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v429 toggleable sync bar patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
