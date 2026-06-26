# revert_id_tsx_v312_memo_sort.ps1
# Reverts the V312 sortStreamsByLanguage memoization patch.
# Restores the original function signature; removes the cache vars + impl wrapper.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v312-revert] ERROR: cannot find app\details\[type]\[id].tsx'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -notmatch 'V312_SORT_MEMO') {
    Write-Host '[v312-revert] no V312 guard present - nothing to revert'
    exit 0
}

# The whole replacement we inserted earlier.  We strip it back to the
# original anchor line.
$v312Block = @'
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

$original = @'
function sortStreamsByLanguage(streams: Stream[]): Stream[] {
'@

if (-not $s.Contains($v312Block)) {
    Write-Host '[v312-revert] ERROR: V312 block not found verbatim'
    Write-Host '            id.tsx may have been further edited - manual revert needed'
    exit 2
}

$s2 = $s.Replace($v312Block, $original)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v312-revert] reverted - sortStreamsByLanguage back to original'
Write-Host '[v312-revert] redeploy with deploy_ota.bat'
