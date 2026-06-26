# patch_discover_tsx_v313_featured_rename.ps1
# V313 - Rename Cinemeta "New Movies/Series" rows to "Featured Movies/Series".
# Surgical: swaps the word "New" -> "Featured" on the catalog's display title
# only.  Does NOT change the underlying catalog data source (Cinemeta's
# `year` catalog still serves the items, sorted newest-first).
#
# Idempotent: re-running with the V313 guard present is a no-op.

$ErrorActionPreference = 'Stop'
$f = 'app\(tabs)\discover.tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v313] ERROR: cannot find app\(tabs)\discover.tsx'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V313_FEATURED_RENAME') {
    Write-Host '[v313] guard already present - no-op'
    exit 0
}

# Two anchors - movies row title and series row title
$anchorMovies = @'
        title: hasMov ? sName : `${sName} Movies`,
'@
$anchorSeries = @'
        title: hasSer ? sName : `${sName} Series`,
'@

$replacementMovies = @'
        // V313_FEATURED_RENAME - "New Movies" -> "Featured Movies"
        title: (hasMov ? sName : `${sName} Movies`).replace(/\bNew\b/i, 'Featured'),
'@
$replacementSeries = @'
        // V313_FEATURED_RENAME - "New Series" -> "Featured Series"
        title: (hasSer ? sName : `${sName} Series`).replace(/\bNew\b/i, 'Featured'),
'@

if (-not $s.Contains($anchorMovies)) {
    Write-Host '[v313] ERROR: movies title anchor not found'
    exit 2
}
if (-not $s.Contains($anchorSeries)) {
    Write-Host '[v313] ERROR: series title anchor not found'
    exit 3
}

$s2 = $s.Replace($anchorMovies, $replacementMovies).Replace($anchorSeries, $replacementSeries)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v313] patched discover.tsx - guard V313_FEATURED_RENAME now present'
Write-Host '[v313] "New Movies"/"New Series" rows will now render as "Featured Movies"/"Featured Series"'
