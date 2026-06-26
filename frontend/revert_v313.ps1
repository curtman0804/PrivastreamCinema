# revert_discover_tsx_v313_featured_rename.ps1
# Reverts the V313 cosmetic "New" -> "Featured" rename in discover.tsx.
# Restores the original title computation.  Run BEFORE applying V314 backend
# patch so the new "Featured" rows aren't double-renamed.

$ErrorActionPreference = 'Stop'
$f = 'app\(tabs)\discover.tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v313-revert] ERROR: cannot find app\(tabs)\discover.tsx'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -notmatch 'V313_FEATURED_RENAME') {
    Write-Host '[v313-revert] no V313 guard present - nothing to revert'
    exit 0
}

$patchedMovies = @'
        // V313_FEATURED_RENAME - "New Movies" -> "Featured Movies"
        title: (hasMov ? sName : `${sName} Movies`).replace(/\bNew\b/i, 'Featured'),
'@
$originalMovies = @'
        title: hasMov ? sName : `${sName} Movies`,
'@

$patchedSeries = @'
        // V313_FEATURED_RENAME - "New Series" -> "Featured Series"
        title: (hasSer ? sName : `${sName} Series`).replace(/\bNew\b/i, 'Featured'),
'@
$originalSeries = @'
        title: hasSer ? sName : `${sName} Series`,
'@

$s2 = $s.Replace($patchedMovies, $originalMovies).Replace($patchedSeries, $originalSeries)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v313-revert] reverted - discover.tsx titles back to original'
