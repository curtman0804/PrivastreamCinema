# patch_id_tsx_v312_memo_sort.ps1
# V312 - Memoize sortStreamsByLanguage by streams identity.
# Same `streams` reference -> instant cache hit (no recompute).
# Different reference -> recompute once, refresh cache.
# Eliminates the 5 inline non-memoized call sites recomputing 122 streams.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v312] ERROR: cannot find app\details\[type]\[id].tsx'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V312_SORT_MEMO') {
    Write-Host '[v312] guard already present - no-op'
    exit 0
}

$anchor = @'
function sortStreamsByLanguage(streams: Stream[]): Stream[] {
'@

if (-not $s.Contains($anchor)) {
    Write-Host '[v312] ERROR: sortStreamsByLanguage anchor not found'
    exit 2
}

$replacement = @'
// V312_SORT_MEMO - single-entry cache keyed by the input array IDENTITY.
// Same `streams` ref returns the cached output instantly, eliminating the
// 3-4 redundant sort passes that fire from inline (non-memoized) call
// sites within a single render.  When streams state updates (new ref),
// the cache misses and we recompute exactly once.
let _v312_sortCacheInput: Stream[] | null = null;
let _v312_sortCacheOutput: Stream[] | null = null;
function sortStreamsByLanguage(streams: Stream[]): Stream[] {
  // V312_SORT_MEMO fast-path
  if (_v312_sortCacheInput === streams && _v312_sortCacheOutput) {
    return _v312_sortCacheOutput;
  }
  const _v312_result = _v312_sortStreamsByLanguageImpl(streams);
  _v312_sortCacheInput = streams;
  _v312_sortCacheOutput = _v312_result;
  return _v312_result;
}
function _v312_sortStreamsByLanguageImpl(streams: Stream[]): Stream[] {
'@

$s2 = $s.Replace($anchor, $replacement)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v312] patched id.tsx - guard V312_SORT_MEMO now present'
Write-Host '[v312] sortStreamsByLanguage now memoizes on input array identity'
