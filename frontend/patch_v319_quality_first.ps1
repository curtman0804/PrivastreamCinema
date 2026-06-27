# patch_v319_quality_first.ps1
# V319 - Flip the Firestick-era compatibility penalties.  User confirms
# their hardware handles HDR / HEVC / REMUX fine and visibly prefers
# those streams.  The previous SDR-first heuristic was aggressively
# wrong for their setup:
#   - HDR penalty was -3000 (now +500 bonus)
#   - HEVC penalty was -300 / -300 (now neutral +200 bonus)
#   - Dolby Vision penalty was -1500 (now +200 bonus)
#   - V158 REMUX/lossless-audio "kill" was -1500 (now 0; V146 still
#     applies softer per-codec penalties to avoid known ExoPlayer
#     AudioTrack.init() failures)
#
# Net effect:
#   Pre-V319  4K HDR REMUX HEVC + DTS-HD MA:  +800 -3000 -300 -1500 -400 = -4400
#   Post-V319 same stream:                   +800 +500 +200 -400         = +1100
#   Same 1080p SDR WEB-DL competitor:         +600 +75                   =  +675
# So the big HDR REMUX now wins auto-pick.
#
# If a chosen stream genuinely crashes on playback, user can click
# another card.  This matches the explicit preference: "best quality,
# but obviously playback if we can't get it."
#
# Affects only id.tsx.  ASCII-only anchors.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v319] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V319_QUALITY_FIRST') {
  Write-Host '[v319] already patched, skipping'
  exit 0
}

# ---------- 1) HEVC: was +300 if SDR / -300 if HEVC.  Now +0 / +200. ----------
$bad1 = 'if (!info.isHEVC) s += 300; else s -= 300;'
$good1 = '/* V319_QUALITY_FIRST */ if (!info.isHEVC) s += 0; else s += 200;'
if (-not $s.Contains($bad1)) { Write-Host '[v319] ERROR: HEVC anchor not found'; exit 2 }
$s = $s.Replace($bad1, $good1)

# ---------- 2) HDR: was +75 if SDR / -3000 if HDR.  Now +0 / +500. ----------
$bad2 = 'if (!info.isHDR) s += 75; else s -= 3000;'
$good2 = '/* V319_QUALITY_FIRST */ if (!info.isHDR) s += 0; else s += 500;'
if (-not $s.Contains($bad2)) { Write-Host '[v319] ERROR: HDR anchor not found'; exit 3 }
$s = $s.Replace($bad2, $good2)

# ---------- 3) Dolby Vision: was -1500.  Now +200. ----------
$bad3 = 'if (_v272IsDV) s -= 1500;'
$good3 = '/* V319_QUALITY_FIRST */ if (_v272IsDV) s += 200;'
if (-not $s.Contains($bad3)) { Write-Host '[v319] ERROR: DV anchor not found'; exit 4 }
$s = $s.Replace($bad3, $good3)

# ---------- 4) V158 REMUX/lossless-audio blanket: was -1500.  Now 0. ----------
# V146 still applies per-codec moderate penalties so genuinely uncrashable
# stuff (AC3/AAC/E-AC3) still gets a small edge.
$bad4 = 'if (_v158_badAudio) s -= 1500;'
$good4 = '/* V319_QUALITY_FIRST */ if (_v158_badAudio) s -= 0;'
if (-not $s.Contains($bad4)) { Write-Host '[v319] ERROR: V158 audio anchor not found'; exit 5 }
$s = $s.Replace($bad4, $good4)

Set-Content -LiteralPath $f -Value $s -NoNewline -Encoding UTF8

Write-Host ''
Write-Host '[v319] id.tsx patched - V319_QUALITY_FIRST marker now present at 4 sites'
Write-Host '[v319] After deploy_ota.bat + app restart, auto-pick should land on big HDR/HEVC streams.'
Write-Host '[v319] Verify with:  adb logcat -d -t 200 ReactNativeJS:V *:S | findstr SORT'
Write-Host '[v319] Expected: [SORT v141] picked top: 4K cached=... seeders=...'
Write-Host '[v319] If chosen stream fails to play, click a different card - the size/quality info'
Write-Host '[v319] on each card now reflects the true ranking the score gave it.'
