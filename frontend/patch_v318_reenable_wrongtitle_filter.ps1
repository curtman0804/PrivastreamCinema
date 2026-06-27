# patch_v318_reenable_wrongtitle_filter.ps1
# V318 - Re-enable the V157/V161 wrong-title/wrong-series filters.
#
# Root cause
# ----------
# v233 added an early `return false;` to both _v157_isWrongTitleStream
# (movies) and _v161_isWrongSeriesStream (series) on the assumption that
# the backend would only return streams matching the requested IMDB id.
# Torrentio in practice serves whatever torrent file is mapped to the
# IMDB hash, and torrents with WRONG metadata tags (e.g. a Masters of the
# Universe rip tagged as Project Hail Mary) slip through.  With the
# client filter neutered, those wrong-movie streams reach the user and
# play when clicked.
#
# Fix
# ---
# Delete `return false;` from both functions so the existing year-check
# and sequel-marker / series-word filtering runs again.  The legacy
# kill-comment ("// v233 ...") survives as a leading line comment so the
# diff is minimal.
#
# Affects: app\details\[type]\[id].tsx ONLY.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[v318] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V318_REENABLED') {
  Write-Host '[v318] already patched, skipping'
  exit 0
}

# ASCII-only anchor on purpose - the original line ends in an em-dash
# comment which PowerShell 5.1 mis-decodes.  We anchor on the leading
# `return false; // v233 client filters disabled` (unique to both kill
# lines) and let the trailing em-dash text stay attached to the comment.
$bad = '  return false; // v233 client filters disabled'
$good = '  /* V318_REENABLED - filter now runs */ // v233 was'

$occurrences = ([regex]::Matches($s, [regex]::Escape($bad))).Count
if ($occurrences -lt 2) {
  Write-Host "[v318] ERROR: expected 2 occurrences of the v233 kill anchor, found $occurrences"
  exit 2
}

$s2 = $s.Replace($bad, $good)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host "[v318] id.tsx patched - revived V157 (movies) + V161 (series) filters ($occurrences sites)"
Write-Host '[v318] After deploy_ota.bat + app restart, on a wrong-movie repro you should see:'
Write-Host '[v318]   [v157] wrong-title filter for "Project Hail Mary" year=2026 kept N/M (rejected K)'
Write-Host '[v318] in logcat.  Any stream tagged with a different year (e.g. 1987 Masters of the Universe)'
Write-Host '[v318] or different sequel marker will be dropped before reaching the stream-card list.'
