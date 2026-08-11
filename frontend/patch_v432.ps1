# patch_v432.ps1 - Direct Pressable + focus-based hide-timer reset
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V432  Focus-driven sync bar w/ persistent visibility"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V432_PRESSABLE_SYNC')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) Rip out v431 sync bar block.
# ============================================================
$v431Start = '{/* V431_TV_FOCUS_SYNC - compact toggleable sync bar with TVFocusButton'
$v431End = '</TVFocusButton>
              </View>
            )}'
$si = $p.IndexOf($v431Start)
if ($si -ge 0) {
    $chunk = $p.Substring($si)
    $ei = $chunk.IndexOf($v431End)
    if ($ei -ge 0) {
        $len = $ei + $v431End.Length
        $p = $p.Remove($si, $len)
        Write-Host "[OK] removed v431 sync bar"
    }
}

# ============================================================
# 2) Change hide timer to 5s in the v429 state block.
# ============================================================
$p = $p.Replace('_v429HideTimer.current = setTimeout(() => setShowSyncBar(false), 6000);',
                '_v429HideTimer.current = setTimeout(() => setShowSyncBar(false), 5000);')

# ============================================================
# 3) Insert new sync bar using inline Pressable (proper TV focus).
# ============================================================
$stampAnchor = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'

$newBar = @'
            {/* V432_PRESSABLE_SYNC - compact sync bar using Pressable directly
                so onFocus/onBlur fire reliably on Android TV. Every focus
                event resets the 5-second hide timer, so the bar stays as
                long as the user is navigating buttons. */}
            {showSyncBar && selectedSubtitle && subtitleCues.length > 0 && (() => {
              const _mkBtn = (key: string, label: string, delta: number, opts: { accent?: boolean; preferred?: boolean; textStyle?: any } = {}) => (
                <Pressable
                  key={key}
                  focusable={true}
                  hasTVPreferredFocus={opts.preferred}
                  onPress={() => { _v429NudgeOffset(delta); }}
                  onFocus={() => { setSyncFocusKey(key); _v429ResetHideTimer(); }}
                  onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === key ? null : prev); }}
                  style={({ focused }: any) => {
                    const isFocused = focused || syncFocusKey === key;
                    return {
                      paddingHorizontal: 12, paddingVertical: 8,
                      marginHorizontal: 2,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: isFocused ? '#B8A05C' : 'transparent',
                      backgroundColor: isFocused ? 'rgba(184,160,92,0.20)' : 'transparent',
                    };
                  }}
                >
                  <Text style={[
                    { color: opts.accent ? '#B8A05C' : '#FFFFFF', fontWeight: 'bold', fontSize: 13 },
                    opts.textStyle,
                  ]}>
                    {label}
                  </Text>
                </Pressable>
              );
              return (
                <View
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    top: 40, alignSelf: 'center',
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 8, paddingVertical: 8,
                    backgroundColor: 'rgba(15,15,15,0.96)',
                    borderRadius: 24,
                    zIndex: 40,
                    borderWidth: 1,
                    borderColor: '#333',
                  }}
                >
                  {_mkBtn('m5',  '-5s',   -5000, { accent: true })}
                  {_mkBtn('m1',  '-1s',   -1000, { preferred: true })}
                  {_mkBtn('m01', '-0.1s',  -100, { textStyle: { fontSize: 12 } })}
                  <View style={{ minWidth: 64, alignItems: 'center', paddingHorizontal: 6 }}>
                    <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 14 }}>
                      {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                    </Text>
                  </View>
                  {_mkBtn('p01', '+0.1s',   100, { textStyle: { fontSize: 12 } })}
                  {_mkBtn('p1',  '+1s',    1000)}
                  {_mkBtn('p5',  '+5s',    5000, { accent: true })}

                  <Pressable
                    focusable={true}
                    onPress={() => { setSubtitleOffset(0); _v429ResetHideTimer(); }}
                    onFocus={() => { setSyncFocusKey('reset'); _v429ResetHideTimer(); }}
                    onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === 'reset' ? null : prev); }}
                    style={({ focused }: any) => {
                      const isFocused = focused || syncFocusKey === 'reset';
                      return {
                        paddingHorizontal: 12, paddingVertical: 8,
                        marginLeft: 8,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: isFocused ? '#B8A05C' : 'transparent',
                        backgroundColor: isFocused ? 'rgba(184,160,92,0.20)' : 'transparent',
                        borderLeftWidth: 1,
                        borderLeftColor: '#333',
                      };
                    }}
                  >
                    <Text style={{ color: '#AAA', fontSize: 12 }}>Reset</Text>
                  </Pressable>

                  <Pressable
                    focusable={true}
                    onPress={() => setShowSyncBar(false)}
                    onFocus={() => { setSyncFocusKey('done'); _v429ResetHideTimer(); }}
                    onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === 'done' ? null : prev); }}
                    style={({ focused }: any) => {
                      const isFocused = focused || syncFocusKey === 'done';
                      return {
                        paddingHorizontal: 14, paddingVertical: 8,
                        marginLeft: 8,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: isFocused ? '#B8A05C' : 'transparent',
                        backgroundColor: isFocused ? '#B8A05C' : 'rgba(184,160,92,0.25)',
                      };
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 }}>Done</Text>
                  </Pressable>
                </View>
              );
            })()}

            
'@

if (-not $p.Contains($stampAnchor)) { Write-Host "[FATAL] stamp anchor missing"; exit 1 }
$p = $p.Replace($stampAnchor, $newBar + '            {/* V416_STAMP - visible boot pill so we can confirm the OTA')

# Bump stamp
$p = $p.Replace("OTA v431", "OTA v432")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v432 patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
