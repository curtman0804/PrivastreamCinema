# patch_v431.ps1 - Use TVFocusButton for sync bar + theme gold colors
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V431  TVFocusButton + gold theme"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V431_TV_FOCUS_SYNC')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) Rip out the v429 sync bar block entirely.
# ============================================================
$v429Start = '{/* V429_TOGGLEABLE_SYNC - user-triggered sync bar with a visible'
$v429End   = ')})()}'
$si = $p.IndexOf($v429Start)
if ($si -ge 0) {
    $chunk = $p.Substring($si)
    $ei = $chunk.IndexOf($v429End)
    if ($ei -ge 0) {
        $len = $ei + $v429End.Length
        $p = $p.Remove($si, $len)
        Write-Host "[OK] removed v429 old sync bar"
    }
}

# ============================================================
# 2) Rip out the v430 picker button block.
# ============================================================
$v430Start = '{/* V430_PICKER_SYNC_BTN - Adjust Subtitle Sync entry point.'
$v430End   = '</TouchableOpacity>
              )}'
$si = $p.IndexOf($v430Start)
if ($si -ge 0) {
    $chunk = $p.Substring($si)
    $ei = $chunk.IndexOf($v430End)
    if ($ei -ge 0) {
        $len = $ei + $v430End.Length
        $p = $p.Remove($si, $len)
        Write-Host "[OK] removed v430 old picker button"
    }
}

# ============================================================
# 3) Insert NEW picker button using TVFocusButton + gold theme.
# ============================================================
$pickerAnchor = '<Text style={styles.subtitleModalTitle}>Subtitles</Text>'
$pickerNew = @'
<Text style={styles.subtitleModalTitle}>Subtitles</Text>

              {/* V431_TV_FOCUS_SYNC - Adjust Sync button, TVFocusButton for
                  proper Android-TV focus events; theme gold. */}
              {selectedSubtitle && subtitleCues.length > 0 && (
                <TVFocusButton
                  onPress={() => {
                    if (typeof setShowSubtitlePicker === 'function') setShowSubtitlePicker(false);
                    if (typeof setShowSubtitles === 'function') setShowSubtitles(false);
                    setShowSyncBar(true);
                  }}
                  style={{
                    marginLeft: 16,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    backgroundColor: '#1a1a1a',
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: '#333',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 13 }}>
                    Adjust Sync ({subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s)
                  </Text>
                </TVFocusButton>
              )}
'@
if ($p.Contains($pickerAnchor)) {
    $p = $p.Replace($pickerAnchor, $pickerNew)
    Write-Host "[OK] added v431 picker button"
} else {
    Write-Host "[FATAL] picker anchor missing"; exit 1
}

# ============================================================
# 4) Insert NEW sync bar using TVFocusButton + gold theme.
# ============================================================
$stampAnchor = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'

$newBar = @'
            {/* V431_TV_FOCUS_SYNC - compact toggleable sync bar with TVFocusButton
                for proper Android-TV focus. Gold theme, visible focus border. */}
            {showSyncBar && selectedSubtitle && subtitleCues.length > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: 40, alignSelf: 'center',
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 8, paddingVertical: 8,
                  backgroundColor: 'rgba(15,15,15,0.95)',
                  borderRadius: 24,
                  zIndex: 30,
                  borderWidth: 1,
                  borderColor: '#333',
                }}
              >
                <TVFocusButton
                  onPress={() => _v429NudgeOffset(-5000)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    marginHorizontal: 2,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 13 }}>-5s</Text>
                </TVFocusButton>
                <TVFocusButton
                  hasTVPreferredFocus
                  onPress={() => _v429NudgeOffset(-1000)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    marginHorizontal: 2,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 }}>-1s</Text>
                </TVFocusButton>
                <TVFocusButton
                  onPress={() => _v429NudgeOffset(-100)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 8,
                    marginHorizontal: 2,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 12 }}>-0.1s</Text>
                </TVFocusButton>
                <View style={{ minWidth: 62, alignItems: 'center', paddingHorizontal: 6 }}>
                  <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 14 }}>
                    {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                  </Text>
                </View>
                <TVFocusButton
                  onPress={() => _v429NudgeOffset(100)}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 8,
                    marginHorizontal: 2,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontSize: 12 }}>+0.1s</Text>
                </TVFocusButton>
                <TVFocusButton
                  onPress={() => _v429NudgeOffset(1000)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    marginHorizontal: 2,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 }}>+1s</Text>
                </TVFocusButton>
                <TVFocusButton
                  onPress={() => _v429NudgeOffset(5000)}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    marginHorizontal: 2,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#B8A05C', fontWeight: 'bold', fontSize: 13 }}>+5s</Text>
                </TVFocusButton>
                <TVFocusButton
                  onPress={() => { setSubtitleOffset(0); _v429ResetHideTimer(); }}
                  style={{
                    paddingHorizontal: 12, paddingVertical: 8,
                    marginLeft: 8,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                    borderLeftWidth: 1,
                    borderLeftColor: '#333',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: 'rgba(184,160,92,0.15)',
                  }}
                >
                  <Text style={{ color: '#AAA', fontSize: 12 }}>Reset</Text>
                </TVFocusButton>
                <TVFocusButton
                  onPress={() => setShowSyncBar(false)}
                  style={{
                    paddingHorizontal: 14, paddingVertical: 8,
                    marginLeft: 8,
                    borderRadius: 6,
                    borderWidth: 2,
                    borderColor: 'transparent',
                    backgroundColor: 'rgba(184,160,92,0.25)',
                  }}
                  focusedStyle={{
                    borderColor: '#B8A05C',
                    backgroundColor: '#B8A05C',
                  }}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: 'bold', fontSize: 13 }}>Done</Text>
                </TVFocusButton>
              </View>
            )}

            
'@

if (-not $p.Contains($stampAnchor)) { Write-Host "[FATAL] stamp anchor missing"; exit 1 }
$p = $p.Replace($stampAnchor, $newBar + '            {/* V416_STAMP - visible boot pill so we can confirm the OTA')

# Bump stamp
$p = $p.Replace("OTA v430", "OTA v431")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v431 patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
