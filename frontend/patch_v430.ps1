# patch_v430.ps1 - Fix v429 anchor - inject Adjust Subtitle Sync button
$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host "========================================="
Write-Host "  V430  Fix picker anchor for sync button"
Write-Host "========================================="

$pPath = 'app\player.tsx'
$pAbs  = (Resolve-Path -LiteralPath $pPath).Path
$p     = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V430_PICKER_SYNC_BTN')) { Write-Host "[SKIP] already applied"; exit 0 }

# ============================================================
# 1) Remove any existing (v426-era) sync block INSIDE the CC picker.
#    We identify it by the unique "Sync Adjustment" label text.
#    Delete from "{selectedSubtitle && (" up through its matching ")}"
#    surrounding that label.
# ============================================================
$syncLabelIdx = $p.IndexOf('<Text style={styles.syncLabel}>Sync Adjustment</Text>')
if ($syncLabelIdx -ge 0) {
    # Walk back to find the enclosing '{selectedSubtitle && (' on its own line
    $before = $p.Substring(0, $syncLabelIdx)
    $blockStart = $before.LastIndexOf('{selectedSubtitle && (')
    if ($blockStart -ge 0) {
        # Find the matching ')}' that closes the block. Skip lines until
        # we find a line containing just '            )}\n' (block end).
        $after = $p.Substring($syncLabelIdx)
        $endMarker = ")}`n"
        # Look for the pattern where we return from inside a JSX conditional
        # Since block contains multiple ')' we need to count.
        $depth = 1
        $i = 0
        # Walk from block start finding matching '(' and ')' but this is fragile.
        # Simpler: just delete lines from blockStart to first line
        # exactly matching a `)}` after we see `</View>` `</View>` etc.
        # Use a regex fallback: find the FIRST `            )}` that follows syncHint text.
        $hintIdx = $p.IndexOf('Subtitles too early? Use + | Too late? Use -', $syncLabelIdx)
        if ($hintIdx -ge 0) {
            $endBlockIdx = $p.IndexOf(')}', $hintIdx)
            if ($endBlockIdx -ge 0) {
                # Include the )} and any trailing newline
                $endBlockIdx += 2
                $len = $endBlockIdx - $blockStart
                $p = $p.Remove($blockStart, $len)
                Write-Host "[OK] removed old Sync Adjustment block from picker"
            }
        }
    }
}

# ============================================================
# 2) Inject the new "Adjust Subtitle Sync" button right after the
#    picker title, using subtitleModalTitle as anchor.
# ============================================================
$anchor = '<Text style={styles.subtitleModalTitle}>Subtitles</Text>'
$inject = @'
<Text style={styles.subtitleModalTitle}>Subtitles</Text>

              {/* V430_PICKER_SYNC_BTN - Adjust Subtitle Sync entry point.
                  Only visible when a sub is loaded. Opens the compact
                  sync bar (v429) so user can nudge timing live. */}
              {selectedSubtitle && subtitleCues.length > 0 && (
                <TouchableOpacity
                  focusable
                  onPress={() => {
                    if (typeof setShowSubtitlePicker === 'function') setShowSubtitlePicker(false);
                    if (typeof setShowSubtitles === 'function') setShowSubtitles(false);
                    setShowSyncBar(true);
                  }}
                  style={{
                    marginLeft: 16,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    backgroundColor: '#2a3a5a',
                    borderRadius: 6,
                  }}
                >
                  <Text style={{ color: '#66CCFF', fontWeight: 'bold', fontSize: 13 }}>
                    Adjust Sync ({subtitleOffset >= 0 ? '+' : ''}{(subtitleOffset / 1000).toFixed(1)}s)
                  </Text>
                </TouchableOpacity>
              )}
'@

if (-not $p.Contains($anchor)) { Write-Host "[FATAL] subtitleModalTitle anchor missing"; exit 1 }
$p = $p.Replace($anchor, $inject)
Write-Host "[OK] added Adjust Sync button to picker header"

# Bump stamp
$p = $p.Replace("OTA v429", "OTA v430")

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[OK] v430 patched"
Write-Host ""
Write-Host "Now run: deploy_ota.bat"
