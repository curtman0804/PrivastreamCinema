# patch_v433.ps1 - Picker checkmark focus + sync bar D-pad + reset border + Current label
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V433  Polished sync bar + focus routing"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V433_POLISHED')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) In the CC picker FlatList, add hasTVPreferredFocus to the
#    currently-selected sub so it auto-focuses when picker opens.
# ============================================================
$listOld = @'
                renderItem={({ item }) => (
                  <TVFocusButton
                    style={[
'@
$listNew = @'
                renderItem={({ item }) => (
                  <TVFocusButton
                    hasTVPreferredFocus={
                      /* V433_POLISHED - autofocus currently-selected sub */
                      (item.url === selectedSubtitle) ||
                      (item.lang === 'off' && !selectedSubtitle)
                    }
                    style={[
'@
if ($p.Contains($listOld)) {
    $p = $p.Replace($listOld, $listNew)
    Write-Host "[OK] added hasTVPreferredFocus to active sub item"
}

# ============================================================
# 2) Rip out v432 sync bar block.
# ============================================================
$v432Start = '{/* V432_PRESSABLE_SYNC - compact sync bar using Pressable directly'
$v432End = ')})()}'
$si = $p.IndexOf($v432Start)
if ($si -ge 0) {
    $chunk = $p.Substring($si)
    $ei = $chunk.IndexOf($v432End)
    if ($ei -ge 0) {
        $len = $ei + $v432End.Length
        $p = $p.Remove($si, $len)
        Write-Host "[OK] removed v432 sync bar"
    }
}

# ============================================================
# 3) Insert new polished sync bar.
# ============================================================
$stampAnchor = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'

$newBar = @'
            {/* V433_POLISHED - sync bar with explicit next-focus routing,
                gold theme, "Current" label under offset, fixed Reset border. */}
            {showSyncBar && selectedSubtitle && subtitleCues.length > 0 && (() => {
              const _btnStyle = (isFocused: boolean) => ({
                paddingHorizontal: 14, paddingVertical: 10,
                marginHorizontal: 3,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: isFocused ? '#B8A05C' : 'transparent',
                backgroundColor: isFocused ? 'rgba(184,160,92,0.20)' : 'transparent',
                minWidth: 52,
                alignItems: 'center' as 'center',
              });
              const _mkBtn = (key: string, label: string, delta: number, opts: { accent?: boolean; preferred?: boolean; small?: boolean } = {}) => (
                <Pressable
                  key={key}
                  focusable={true}
                  hasTVPreferredFocus={opts.preferred}
                  onPress={() => { _v429NudgeOffset(delta); }}
                  onFocus={() => { setSyncFocusKey(key); _v429ResetHideTimer(); }}
                  onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === key ? null : prev); }}
                  style={({ focused }: any) => _btnStyle(focused || syncFocusKey === key)}
                >
                  <Text style={{
                    color: opts.accent ? '#B8A05C' : '#FFFFFF',
                    fontWeight: 'bold',
                    fontSize: opts.small ? 12 : 14,
                  }}>
                    {label}
                  </Text>
                </Pressable>
              );
              return (
                <View
                  pointerEvents="box-none"
                  style={{
                    position: 'absolute',
                    top: 50, alignSelf: 'center',
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingHorizontal: 12, paddingVertical: 10,
                    backgroundColor: 'rgba(15,15,15,0.96)',
                    borderRadius: 28,
                    zIndex: 40,
                    borderWidth: 1,
                    borderColor: '#333',
                  }}
                >
                  {_mkBtn('m5',  '-5s',   -5000, { accent: true })}
                  {_mkBtn('m1',  '-1s',   -1000, { preferred: true })}
                  {_mkBtn('m01', '-0.1s',  -100, { small: true })}

                  {/* Current offset display - NOT focusable, D-pad skips over. */}
                  <View
                    focusable={false}
                    style={{
                      minWidth: 78,
                      alignItems: 'center',
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      marginHorizontal: 4,
                      borderLeftWidth: 1,
                      borderRightWidth: 1,
                      borderColor: '#333',
                    }}
                  >
                    <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 15 }}>
                      {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                    </Text>
                    <Text style={{ color: '#777', fontSize: 10, marginTop: 1, letterSpacing: 0.5 }}>
                      CURRENT
                    </Text>
                  </View>

                  {_mkBtn('p01', '+0.1s',   100, { small: true })}
                  {_mkBtn('p1',  '+1s',    1000)}
                  {_mkBtn('p5',  '+5s',    5000, { accent: true })}

                  {/* Reset - with margin space so its focus border doesn't clip. */}
                  <Pressable
                    focusable={true}
                    onPress={() => { setSubtitleOffset(0); _v429ResetHideTimer(); }}
                    onFocus={() => { setSyncFocusKey('reset'); _v429ResetHideTimer(); }}
                    onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === 'reset' ? null : prev); }}
                    style={({ focused }: any) => {
                      const isFocused = focused || syncFocusKey === 'reset';
                      return {
                        paddingHorizontal: 14, paddingVertical: 10,
                        marginHorizontal: 6,
                        marginLeft: 10,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: isFocused ? '#B8A05C' : 'transparent',
                        backgroundColor: isFocused ? 'rgba(184,160,92,0.20)' : 'transparent',
                      };
                    }}
                  >
                    <Text style={{ color: '#AAA', fontSize: 13 }}>Reset</Text>
                  </Pressable>

                  {/* Done - filled gold on focus. */}
                  <Pressable
                    focusable={true}
                    onPress={() => setShowSyncBar(false)}
                    onFocus={() => { setSyncFocusKey('done'); _v429ResetHideTimer(); }}
                    onBlur={() => { _v429ResetHideTimer(); setSyncFocusKey(prev => prev === 'done' ? null : prev); }}
                    style={({ focused }: any) => {
                      const isFocused = focused || syncFocusKey === 'done';
                      return {
                        paddingHorizontal: 18, paddingVertical: 10,
                        marginLeft: 6,
                        borderRadius: 6,
                        borderWidth: 2,
                        borderColor: isFocused ? '#B8A05C' : '#8a7444',
                        backgroundColor: isFocused ? '#B8A05C' : 'rgba(184,160,92,0.28)',
                      };
                    }}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 14 }}>Done</Text>
                  </Pressable>
                </View>
              );
            })()}

            
'@

if (-not $p.Contains($stampAnchor)) { Write-Host "[FATAL] stamp anchor missing"; exit 1 }
$p = $p.Replace($stampAnchor, $newBar + '            {/* V416_STAMP - visible boot pill so we can confirm the OTA')

# Bump stamp
$p = $p.Replace("OTA v432", "OTA v433")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v433 polished sync bar applied"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
