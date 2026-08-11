# ============================================================================
# patch_v384.ps1 - ONE loading screen from Play-press to playback (OTA)
#
# PROBLEM: two visibly different loading screens. The details page's
# autoplay overlay (screen 1) hands off to the player's loading screen
# (screen 2) with a different backdrop image, different text ("Loading..."
# -> "Starting playback"), missing episode lines, and a restarting bar -
# so it reads as "one starts, then the other takes over". Direct Play
# presses had NO overlay at all (v238b removed it), so the user stared at
# a frozen details page while Premiumize resolved.
#
# FIX - make the two screens pixel-identical and always show one:
#   [D1] Details: restore instant overlay on Play press (|| isPlayLoading)
#   [D2] Details: pass the EXACT overlay image + text lines to the player
#        (ovName/ovEp/ovSE + same backdrop uri) at all 6 push sites
#   [P1] Player: accept the new params
#   [P2] Player: render identical layout (logo mb20, 32/800 title, episode
#        name line, gold S/E line) and the same "Loading..." footer text
#
# Idempotent: safe to re-run.
# ============================================================================

$ErrorActionPreference = 'Stop'
Set-Location "C:\Users\Curtm\PrivastreamCinema\frontend"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  V384 One Loading Screen" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# details [id].tsx
# ---------------------------------------------------------------------------
$dPath = Get-ChildItem -Path 'app' -Recurse -File | Where-Object { $_.Name -eq '[id].tsx' } | Select-Object -First 1
if (-not $dPath) { Write-Host "[FATAL] [id].tsx not found" -ForegroundColor Red; exit 1 }
$d = [System.IO.File]::ReadAllText($dPath.FullName)

if ($d.Contains('V384_ONE_LOADING_SCREEN')) {
  Write-Host "[SKIP] [id].tsx already patched" -ForegroundColor Yellow
} else {

# --- [D1] restore instant overlay on Play press ---
$old = @'
      {(autoPlayParam === 'true') && (
'@
$new = @'
      {(autoPlayParam === 'true' || isPlayLoading) && ( /* V384_PLAY_FEEDBACK - Play press shows the SAME overlay the player continues */
'@
if (-not $d.Contains($old)) { Write-Host "[FATAL] D1 anchor missing" -ForegroundColor Red; exit 1 }
$d = $d.Replace($old, $new)
Write-Host "[OK] D1: instant overlay on Play" -ForegroundColor Green

# --- [D2a] compute the exact overlay image + text lines once ---
$old = @'
    const resumeData = shouldResume ? { resumePosition } : {};
'@
$new = @'
    const resumeData = shouldResume ? { resumePosition } : {};

    /* V384_ONE_LOADING_SCREEN - hand the player the EXACT image and text
       the details overlay is showing, so its loading screen paints the
       same pixels and the handoff is invisible. */
    const _v384OverlayUri = ((currentEpisode?.thumbnail || nextBackdropParam || content?.background || content?.poster || nextPosterParam) || '') as string;
    const _v384EpLine = type === 'series'
      ? String(nextTitleParam
          || currentEpisode?.name
          || (_v238ValidNum(episodeNumber)
                ? `Episode ${episodeNumber}`
                : (_v238ValidNum(resumeEpisode) ? `Episode ${resumeEpisode}` : '')))
      : '';
    const _v384sN = _v238ValidNum(episodeSeason) ? episodeSeason : (_v238ValidNum(resumeSeason) ? resumeSeason : null);
    const _v384eN = _v238ValidNum(episodeNumber) ? episodeNumber : (_v238ValidNum(resumeEpisode) ? resumeEpisode : null);
    const _v384SELine = type === 'series'
      ? (((_v384sN != null) ? `S${_v384sN}` : '') + ((_v384eN != null) ? ` E${_v384eN}` : '')).trim()
      : '';
    const _v384Pass = {
      ovName: (content?.name || '') as string,
      ovEp: _v384EpLine,
      ovSE: _v384SELine,
    };
'@
if (-not $d.Contains($old)) { Write-Host "[FATAL] D2a anchor missing" -ForegroundColor Red; exit 1 }
$d = $d.Replace($old, $new)
Write-Host "[OK] D2a: overlay uri + text computed" -ForegroundColor Green

# --- [D2b] all 6 push sites: same backdrop + text params ---
$oldLong = @'
backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || nextBackdropParam || '',
'@
$oldShort = @'
backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || '',
'@
$newB = @'
backdrop: _v384OverlayUri, ..._v384Pass, /* V384 */
'@
if (-not ($d.Contains($oldLong) -and $d.Contains($oldShort))) { Write-Host "[FATAL] D2b anchors missing" -ForegroundColor Red; exit 1 }
$d = $d.Replace($oldLong, $newB).Replace($oldShort, $newB)
Write-Host "[OK] D2b: 6 push sites unified" -ForegroundColor Green

[System.IO.File]::WriteAllText($dPath.FullName, $d)
Write-Host "[DONE] [id].tsx written" -ForegroundColor Green
}

# ---------------------------------------------------------------------------
# player.tsx
# ---------------------------------------------------------------------------
$pPath = 'app\player.tsx'
if (!(Test-Path -LiteralPath $pPath)) { Write-Host "[FATAL] player.tsx not found" -ForegroundColor Red; exit 1 }
$pAbs = (Resolve-Path -LiteralPath $pPath).Path
$p = [System.IO.File]::ReadAllText($pAbs)

if ($p.Contains('V384_ONE_LOADING_SCREEN')) {
  Write-Host "[SKIP] player.tsx already patched" -ForegroundColor Yellow
} else {

# --- [P1] accept the new params ---
$old = @'
    backdrop, 
    poster, 
    logo, 
'@
# fall back to no-trailing-space variant
$oldAlt = "    backdrop,`n    poster,`n    logo,`n"
if ($p.Contains($old)) {
  $p = $p.Replace($old, $old + "    ovName, ovEp, ovSE, /* V384_ONE_LOADING_SCREEN */`n")
  Write-Host "[OK] P1: destructure (trailing-space variant)" -ForegroundColor Green
} elseif ($p.Contains($oldAlt)) {
  $p = $p.Replace($oldAlt, $oldAlt + "    ovName, ovEp, ovSE, /* V384_ONE_LOADING_SCREEN */`n")
  Write-Host "[OK] P1: destructure" -ForegroundColor Green
} else {
  Write-Host "[FATAL] P1 anchor missing" -ForegroundColor Red; exit 1
}

$old = @'
    backdrop?: string;
    poster?: string;
    logo?: string;
'@
$new = @'
    backdrop?: string;
    poster?: string;
    logo?: string;
    ovName?: string; ovEp?: string; ovSE?: string; /* V384 */
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] P1b anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] P1b: param types" -ForegroundColor Green

# --- [P2a] logo margin 18 -> 20 (match details overlay) ---
$old = @'
style={{ width: 280, height: 90, marginBottom: 18 }}
'@
$new = @'
style={{ width: 280, height: 90, marginBottom: 20 }}
'@
if ($p.Contains($old)) { $p = $p.Replace($old, $new); Write-Host "[OK] P2a: logo margin" -ForegroundColor Green }
else { Write-Host "[SKIP] P2a (already 20?)" -ForegroundColor Yellow }

# --- [P2b] no-logo title style match + episode lines ---
$old = @'
            {!logo && title ? (
              <Text
                style={{
                  color: '#FFFFFF',
                  fontSize: 22,
                  fontWeight: '700',
                  textAlign: 'center',
                  marginBottom: 28,
                  paddingHorizontal: 16,
                  letterSpacing: 0.3,
                }}
                numberOfLines={2}
              >
                {title}
              </Text>
            ) : null}
'@
$new = @'
            {!logo && (ovName || title) ? (
              <Text
                style={{
                  color: '#FFF',
                  fontSize: 32,
                  fontWeight: '800',
                  textAlign: 'center',
                  marginBottom: 16,
                  paddingHorizontal: 16,
                  letterSpacing: 0.5,
                }}
                numberOfLines={2}
              >
                {String(ovName || title)}
              </Text>
            ) : null}

            {/* V384_ONE_LOADING_SCREEN - identical episode lines to the
                details overlay so the handoff is pixel-perfect. */}
            {ovEp ? (
              <Text style={{ color: '#FFF', fontSize: 20, fontWeight: '600', textAlign: 'center', marginBottom: 6 }}>
                {String(ovEp)}
              </Text>
            ) : null}
            {ovSE ? (
              <Text style={{ color: '#B8A05C', fontSize: 14, fontWeight: '600', marginBottom: 36, letterSpacing: 1 }}>
                {String(ovSE)}
              </Text>
            ) : null}
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] P2b anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] P2b: title + episode lines" -ForegroundColor Green

# --- [P2c] footer text matches details overlay ---
$old = @'
              Starting playback
'@
$new = @'
              Loading...
'@
if (-not $p.Contains($old)) { Write-Host "[FATAL] P2c anchor missing" -ForegroundColor Red; exit 1 }
$p = $p.Replace($old, $new)
Write-Host "[OK] P2c: footer text unified" -ForegroundColor Green

[System.IO.File]::WriteAllText($pAbs, $p)
Write-Host "[DONE] player.tsx written" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done. Run deploy_ota.bat, relaunch twice." -ForegroundColor Cyan
Write-Host ""
