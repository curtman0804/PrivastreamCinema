# patch_v437_frontend.ps1 - Cleanup duplicate sync bars, remove Done, fix D-pad
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "V437 frontend: single sync bar, no Done, tight D-pad"

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V437_SINGLE_BAR')) { Write-Host "[SKIP]"; exit 0 }

# ===== Remove any leftover sync bar blocks (v428, v429, v431, v432, v433) =====
$blockMarkers = @(
    'V428_LIVE_SYNC_BAR',
    'V429_TOGGLEABLE_SYNC - user-triggered sync bar',
    'V431_TV_FOCUS_SYNC - compact toggleable sync bar',
    'V432_PRESSABLE_SYNC - compact sync bar using Pressable',
    'V433_POLISHED - sync bar with explicit next-focus routing'
)
foreach ($m in $blockMarkers) {
    $startIdx = $p.IndexOf("{/* $m")
    if ($startIdx -lt 0) { continue }
    # Find the closing }) or )} that ends this JSX conditional block.
    # Use a simple line-scan: keep looking until we find matching ')})()}'
    # or a bare '</View>\n            )}' pattern.
    $endPatterns = @(')})()}', ")}`n`n            ")
    $bestEnd = -1
    foreach ($ep in $endPatterns) {
        $ei = $p.IndexOf($ep, $startIdx)
        if ($ei -gt $startIdx -and ($bestEnd -lt 0 -or $ei -lt $bestEnd)) { $bestEnd = $ei + $ep.Length }
    }
    if ($bestEnd -gt $startIdx) {
        $p = $p.Remove($startIdx, $bestEnd - $startIdx)
        Write-Host "  removed leftover: $m"
    }
}

# ===== Insert the single clean v437 sync bar =====
$stampAnchor = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'

$newBar = @'
            {/* V437_SINGLE_BAR - single toggleable sync bar, no Done button,
                auto-hides 5s after last interaction. */}
            {showSyncBar && selectedSubtitle && subtitleCues.length > 0 && (() => {
              const _btn = (key: string, label: string, delta: number, accent?: boolean) => (
                <Pressable
                  key={key}
                  focusable={true}
                  hasTVPreferredFocus={key === 'm1'}
                  onPress={() => _v429NudgeOffset(delta)}
                  onFocus={() => { setSyncFocusKey(key); _v429ResetHideTimer(); }}
                  onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === key ? null : prev); }}
                  style={({ focused }: any) => {
                    const isF = focused || syncFocusKey === key;
                    return {
                      paddingHorizontal: 14, paddingVertical: 10,
                      marginHorizontal: 3,
                      borderRadius: 6,
                      borderWidth: 2,
                      borderColor: isF ? '#B8A05C' : 'transparent',
                      backgroundColor: isF ? 'rgba(184,160,92,0.20)' : 'transparent',
                      minWidth: 52, alignItems: 'center',
                    };
                  }}
                >
                  <Text style={{ color: accent ? '#B8A05C' : '#FFFFFF', fontWeight: 'bold', fontSize: 14 }}>
                    {label}
                  </Text>
                </Pressable>
              );
              return (
                <View
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute', top: 50, alignSelf: 'center',
                    flexDirection: 'row', alignItems: 'center',
                    paddingHorizontal: 12, paddingVertical: 10,
                    backgroundColor: 'rgba(15,15,15,0.96)',
                    borderRadius: 28, zIndex: 40,
                    borderWidth: 1, borderColor: '#333',
                  }}
                >
                  {_btn('m5', '-5s', -5000, true)}
                  {_btn('m1', '-1s', -1000)}
                  {_btn('m01', '-0.1s', -100)}
                  <View focusable={false} pointerEvents="none" style={{ minWidth: 78, alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: 4, borderLeftWidth: 1, borderRightWidth: 1, borderColor: '#333' }}>
                    <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 15 }}>
                      {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                    </Text>
                    <Text style={{ color: '#777', fontSize: 10, marginTop: 1 }}>CURRENT</Text>
                  </View>
                  {_btn('p01', '+0.1s', 100)}
                  {_btn('p1', '+1s', 1000)}
                  {_btn('p5', '+5s', 5000, true)}
                  <Pressable
                    focusable={true}
                    onPress={() => { setSubtitleOffset(0); _v429ResetHideTimer(); }}
                    onFocus={() => { setSyncFocusKey('reset'); _v429ResetHideTimer(); }}
                    onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === 'reset' ? null : prev); }}
                    style={({ focused }: any) => {
                      const isF = focused || syncFocusKey === 'reset';
                      return {
                        paddingHorizontal: 14, paddingVertical: 10,
                        marginLeft: 10,
                        borderRadius: 6, borderWidth: 2,
                        borderColor: isF ? '#B8A05C' : 'transparent',
                        backgroundColor: isF ? 'rgba(184,160,92,0.20)' : 'transparent',
                      };
                    }}
                  >
                    <Text style={{ color: '#AAA', fontSize: 13 }}>Reset</Text>
                  </Pressable>
                </View>
              );
            })()}

            
'@

if (-not $p.Contains($stampAnchor)) { Write-Host "[FATAL] stamp anchor missing"; exit 1 }
$p = $p.Replace($stampAnchor, $newBar + '            ' + $stampAnchor)

$p = $p.Replace("OTA v433", "OTA v437")
$p = $p.Replace("OTA v436", "OTA v437")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v437 frontend applied"
