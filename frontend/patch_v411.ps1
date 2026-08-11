# ============================================================================
# patch_v411.ps1 - Forced-subs auto-load (the actually-correct approach).
#
# WHAT CHANGED (versus v407..v410):
#   * OpenSubtitles DOES publish "Forced" subtitle files, which contain
#     ONLY the translated foreign-scene lines (nothing for the English
#     dialogue). E.g. Shang-Chi has a "-Forced.srt". Backend v410 now
#     exposes their filenames via Content-Disposition HEAD.
#   * NEW auto-load rule: if any English sub's filename contains "forced"
#     (or "foreign parts"), auto-load THAT sub and show every one of its
#     cues verbatim. No classifier, no filtering, no false positives.
#   * If NO forced sub exists (e.g. South Park), do NOT auto-load anything.
#     CC stays fully off until the user opens the picker and picks one.
#
# UI CLEANUP (per user):
#   * CC button icon is ALWAYS white. No gold "CC-on" indicator ever.
#   * Picker modal header goes back to plain "Subtitles" - no auto-note.
#   * The v408/v410 classifier code stays in the file (harmless, unused
#     in this flow) so future re-enable is a 1-line change.
#
# REQUIRES: v410 backend applied on Hetzner (server restart done).
# REQUIRES: v407..v410 frontend applied. Idempotent.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V411  Forced-sub auto-load + UI cleanup" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

$pPath = 'app\player.tsx'
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if (-not $p.Contains('V410_PRECISE_FOREIGN')) {
  Write-Host "[FATAL] v410 not applied first" -ForegroundColor Red; exit 1
}
if ($p.Contains('V411_FORCED_PREFERRED')) {
  Write-Host "[SKIP] already applied" -ForegroundColor Yellow; exit 0
}

# --- 1: replace v407's auto-select logic with forced-sub-only auto-load ---
$old = @'
            _v407AutoMatchRef.current = { url: _best.url, reason: _reason };
            // Only auto-select if user has not manually picked one already
            if (!selectedSubtitle) setSelectedSubtitle(_best.url);
'@
$new = @'
            _v407AutoMatchRef.current = { url: _best.url, reason: _reason };
            /* V411_FORCED_PREFERRED - only auto-load subs that contain
               ONLY foreign-scene translations (filename tagged "forced"
               or "foreign parts"). Loaded forced subs display every cue
               as-is - no classifier, since they're already pre-filtered.
               If no forced sub is in the list, we DO NOT auto-load; CC
               stays off until user opens the picker manually. */
            const _v411_isForced = (fn: any) => {
              const _f = String(fn || '');
              return /(?:^|[._\-\s])(?:forced|foreign[._\-\s]*parts?[._\-\s]*only|foreign[._\-\s]*only)/i.test(_f);
            };
            const _v411_forced = (response.subtitles || []).find((s: any) => (
              (s.lang === 'eng' || s.lang === 'en') && _v411_isForced((s as any).filename)
            ));
            if (_v411_forced && !selectedSubtitle) {
              console.log('[V411] auto-loading forced sub:', (_v411_forced as any).filename || _v411_forced.url);
              setSelectedSubtitle(_v411_forced.url);
              // Forced subs are already foreign-only - display every cue
              setV408AutoActive(false);
            } else if (!_v411_forced) {
              console.log('[V411] no forced sub in list - CC stays off');
            }
'@
if (-not $p.Contains($old)) {
  Write-Host "[FATAL] anchor 1 missing (v407 auto-select tail)" -ForegroundColor Red; exit 1
}
$p = $p.Replace($old, $new)
Write-Host "[OK] 1: forced-sub-only auto-load installed" -ForegroundColor Green

# --- 2: kill the gold CC-active icon color (both places) ---
$oldGold = "color={selectedSubtitle ? '#B8A05C' : '#FFFFFF'}"
$newGold = "color={'#FFFFFF'} /* V411_UI - no gold indicator */"
$count = ([regex]::Matches($p, [regex]::Escape($oldGold))).Count
if ($count -gt 0) {
  $p = $p.Replace($oldGold, $newGold)
  Write-Host "[OK] 2: CC button icon forced white in $count place(s)" -ForegroundColor Green
} else {
  Write-Host "[WARN] 2: gold color anchor not found - already clean or different shape" -ForegroundColor DarkYellow
}

# --- 3: kill the ccActive style application on the button (both places) ---
$oldStyle = "style={[styles.controlButton, selectedSubtitle && styles.ccActive]}"
$newStyle = "style={styles.controlButton} /* V411_UI - no active ring */"
$count2 = ([regex]::Matches($p, [regex]::Escape($oldStyle))).Count
if ($count2 -gt 0) {
  $p = $p.Replace($oldStyle, $newStyle)
  Write-Host "[OK] 3: CC button active style removed in $count2 place(s)" -ForegroundColor Green
} else {
  Write-Host "[WARN] 3: ccActive style anchor not found" -ForegroundColor DarkYellow
}

# --- 4: remove the picker header auto-note added by v408 ---
$old = @'
              <View>
                <Text style={styles.subtitleModalTitle}>Subtitles</Text>
                {_v408AutoActive && (
                  <Text style={{ color: '#B8A05C', fontSize: 11, marginTop: 2, letterSpacing: 0.3 }}>
                    Auto: CC on for foreign-language scenes only
                  </Text>
                )}
              </View>
'@
$new = @'
              <Text style={styles.subtitleModalTitle}>Subtitles</Text>{/* V411_UI - no auto note */}
'@
if ($p.Contains($old)) {
  $p = $p.Replace($old, $new)
  Write-Host "[OK] 4: picker header auto-note removed" -ForegroundColor Green
} else {
  Write-Host "[WARN] 4: v408 header wrapper not found (already reverted?)" -ForegroundColor DarkYellow
}

[System.IO.File]::WriteAllText($pAbs, $p)

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V411 applied. Then:" -ForegroundColor Cyan
Write-Host "    deploy_ota.bat" -ForegroundColor Cyan
Write-Host "" -ForegroundColor Cyan
Write-Host "  Expected behavior:" -ForegroundColor Cyan
Write-Host "    * CC button: white, always. No gold indicator anywhere." -ForegroundColor Cyan
Write-Host "    * South Park S1E1: NO CC displayed. Ever." -ForegroundColor Cyan
Write-Host "    * Shang-Chi opening: CC appears during Mandarin lines" -ForegroundColor Cyan
Write-Host "      only, disappears when English dialog starts." -ForegroundColor Cyan
Write-Host "    * Any manual pick in the CC modal - full CC as normal." -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
