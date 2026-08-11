# patch_v426.ps1 - TV-focusable sync buttons + coarser steps + bumped stamp
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V426  Sync adjuster TV focus + big steps"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V426_SYNC_TV')) { Write-Host "[SKIP] already applied"; exit 0 }

$old = @'
            {/* Subtitle Sync Controls */}
            {selectedSubtitle && (
              <View style={styles.syncControlsContainer}>
                <Text style={styles.syncLabel}>Sync Adjustment</Text>
                <View style={styles.syncControls}>
                  <TouchableOpacity 
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev - 500)}
                  >
                    <Text style={styles.syncButtonText}>-0.5s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
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
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev + 100)}
                  >
                    <Text style={styles.syncButtonText}>+0.1s</Text>
                  </TouchableOpacity>
                  <TouchableOpacity 
                    style={styles.syncButton}
                    onPress={() => setSubtitleOffset(prev => prev + 500)}
                  >
                    <Text style={styles.syncButtonText}>+0.5s</Text>
                  </TouchableOpacity>
                </View>
                <TouchableOpacity 
                  style={styles.resetSyncButton}
                  onPress={() => setSubtitleOffset(0)}
                >
                  <Text style={styles.resetSyncText}>Reset to 0</Text>
                </TouchableOpacity>
                <Text style={styles.syncHint}>
                  Subtitles too early? Use + | Too late? Use -
                </Text>
              </View>
            )}
'@

$new = @'
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

if (-not $p.Contains($old)) { Write-Host "[FATAL] anchor missing"; exit 1 }
$p = $p.Replace($old, $new)

# Add TV-focus visual style if not present
if (-not $p.Contains('syncButtonCoarse')) {
  $styleAnchor = 'syncButton: {'
  if ($p.Contains($styleAnchor)) {
    $extra = @'
syncButtonCoarse: {
    minWidth: 60,
    backgroundColor: '#3a2a1a',
  },
  syncButton: {
'@
    $p = $p.Replace($styleAnchor, $extra)
    Write-Host "[OK] added syncButtonCoarse style"
  }
}

# Bump stamp
$p = $p.Replace("OTA v422", "OTA v426")
$p = $p.Replace("OTA v417", "OTA v426")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v426 patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
