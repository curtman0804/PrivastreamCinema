# patch_v428.ps1 - Remove auto-sync + move sync bar onto player screen
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V428  Live sync bar on player screen"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V428_LIVE_SYNC_BAR')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) REVERT V427 auto-sync: remove the whole autosync try-block
# ============================================================
$autosyncStart = '/* V427_AUTOSYNC - Auto-detect sync offset from first-cue timestamp.'
$autosyncEnd   = "console.log('[V427 AUTOSYNC] error:', _v427err);
      }"
$startIdx = $p.IndexOf($autosyncStart)
$endIdx = $p.IndexOf($autosyncEnd)
if ($startIdx -ge 0 -and $endIdx -gt $startIdx) {
    $len = ($endIdx - $startIdx) + $autosyncEnd.Length
    $p = $p.Remove($startIdx, $len)
    Write-Host "[OK] reverted v427 auto-sync"
}

# ============================================================
# 2) REMOVE the entire subtitle-sync block from the CC picker modal
# ============================================================
$syncOld = @'
            {/* V426_SYNC_TV - Subtitle Sync Controls with TV D-pad focus */}
            {selectedSubtitle && (
              <View style={styles.syncControlsContainer}>
                <Text style={styles.syncLabel}>Sync Adjustment</Text>
                <View style={styles.syncControls}>
                  <TouchableOpacity
                    focusable
                    hasTVPreferredFocus
                    style={[styles.syncButton, styles.syncButtonCoarse]}
                    onPress={() => setSubtitleOffset(prev => prev - 5000)}
                  >
                    <Text style={styles.syncButtonText}>-5s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    focusable
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev - 1000)}
                  >
                    <Text style={styles.syncButtonText}>-1s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    focusable
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev - 100)}
                  >
                    <Text style={styles.syncButtonText}>-0.1s</Text>
                  </TouchableOpacity>
                  <View style={styles.syncValueContainer}>
                    <Text style={styles.syncValue}>
                      {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                    </Text>
                  </View>
                  <TouchableOpacity
                    focusable
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev + 100)}
                  >
                    <Text style={styles.syncButtonText}>+0.1s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    focusable
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev + 1000)}
                  >
                    <Text style={styles.syncButtonText}>+1s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    focusable
                    style={[styles.syncButton, styles.syncButtonCoarse]}
                    onPress={() => setSubtitleOffset(prev => prev + 5000)}
                  >
                    <Text style={styles.syncButtonText}>+5s</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity
                  focusable
                  style={styles.resetSyncButton}
                  onPress={() => setSubtitleOffset(0)}
                >
                  <Text style={styles.resetSyncText}>Reset to 0</Text>
                </TouchableOpacity>
                <Text style={styles.syncHint}>
                  Subtitles too early? Use + | Too late? Use - | Big diff? Try ±5s first
                </Text>
              </View>
            )}
'@
if ($p.Contains($syncOld)) {
    $p = $p.Replace($syncOld, "")
    Write-Host "[OK] removed sync block from CC picker"
}

# ============================================================
# 3) INJECT the compact live sync bar into the player render tree.
#    Placed right before the V427 auto-sync notice (now removed) or
#    before the V416 stamp. Uses the anchor '{autoSyncNotice &&' if
#    present (from v427) else the V416_STAMP comment.
# ============================================================
$liveBar = @'
            {/* V428_LIVE_SYNC_BAR - compact always-visible sync bar so the
                user can nudge CC timing in real time WITHOUT reopening the
                picker. Positioned at the top of the player above the CC.
                Only visible while a subtitle is active. */}
            {selectedSubtitle && subtitleCues.length > 0 && (
              <View
                style={{
                  position: 'absolute',
                  top: 60, alignSelf: 'center',
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 10, paddingVertical: 6,
                  backgroundColor: 'rgba(0,0,0,0.75)',
                  borderRadius: 24,
                  zIndex: 20,
                }}
              >
                <TouchableOpacity
                  focusable
                  hasTVPreferredFocus={false}
                  onPress={() => setSubtitleOffset(prev => prev - 5000)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#FFCC66', fontWeight: 'bold' }}>-5s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  focusable
                  onPress={() => setSubtitleOffset(prev => prev - 1000)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>-1s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  focusable
                  onPress={() => setSubtitleOffset(prev => prev - 100)}
                  style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#FFF' }}>-0.1s</Text>
                </TouchableOpacity>
                <View style={{ minWidth: 60, alignItems: 'center', paddingHorizontal: 6 }}>
                  <Text style={{ color: '#66CCFF', fontWeight: 'bold', fontSize: 13 }}>
                    {subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s
                  </Text>
                </View>
                <TouchableOpacity
                  focusable
                  onPress={() => setSubtitleOffset(prev => prev + 100)}
                  style={{ paddingHorizontal: 8, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#FFF' }}>+0.1s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  focusable
                  onPress={() => setSubtitleOffset(prev => prev + 1000)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#FFF', fontWeight: 'bold' }}>+1s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  focusable
                  onPress={() => setSubtitleOffset(prev => prev + 5000)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6 }}
                >
                  <Text style={{ color: '#FFCC66', fontWeight: 'bold' }}>+5s</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  focusable
                  onPress={() => setSubtitleOffset(0)}
                  style={{ paddingHorizontal: 10, paddingVertical: 6, borderLeftWidth: 1, borderLeftColor: '#444', marginLeft: 4 }}
                >
                  <Text style={{ color: '#AAA', fontSize: 12 }}>Reset</Text>
                </TouchableOpacity>
              </View>
            )}

'@

# Anchor: just before V416_STAMP block.
$anchor4 = '{/* V416_STAMP - visible boot pill so we can confirm the OTA'
if (-not $p.Contains($anchor4)) { Write-Host "[FATAL] anchor4 missing"; exit 1 }
$p = $p.Replace($anchor4, $liveBar + '            {/* V416_STAMP - visible boot pill so we can confirm the OTA')

# Bump stamp
$p = $p.Replace("OTA v427", "OTA v428")
$p = $p.Replace("OTA v426", "OTA v428")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v428 live sync bar applied"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
