# revert_v318.ps1
# EMERGENCY REVERT - V318 was too strict for unreleased films like
# Project Hail Mary (all available streams have mismatched/missing years
# so the filter dropped 100% of them - no playback at all).  Reverting
# the v233 kill-line restores playback.  Wrong-movie risk returns until
# we ship V319 with a SOFT score penalty instead of hard reject.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'
if (-not (Test-Path -LiteralPath $f)) {
  $alt = 'app\details\id.tsx'
  if (Test-Path -LiteralPath $alt) { $f = $alt }
  else { Write-Host '[revert_v318] ERROR: cannot find id.tsx'; exit 1 }
}

$s = Get-Content -Raw -LiteralPath $f
if (-not ($s -match 'V318_REENABLED')) {
  Write-Host '[revert_v318] V318 marker not present - nothing to revert'
  exit 0
}

$bad = '  /* V318_REENABLED - filter now runs */ // v233 was'
$good = '  return false; // v233 client filters disabled'

$occurrences = ([regex]::Matches($s, [regex]::Escape($bad))).Count
if ($occurrences -lt 2) {
  Write-Host "[revert_v318] expected 2 sites, found $occurrences - aborting"
  exit 2
}

$s2 = $s.Replace($bad, $good)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host "[revert_v318] reverted V318 at $occurrences sites - V157/V161 filters disabled again"
Write-Host '[revert_v318] Run deploy_ota.bat, restart app - Project Hail Mary playback should work again.'
