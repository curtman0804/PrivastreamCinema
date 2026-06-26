# patch_id_tsx_v311_perf.ps1
# V311 - PowerShell patcher (v2 - safe quoting).
# Adds V311_PERF_PROFILER instrumentation to app/details/[type]/[id].tsx.

$ErrorActionPreference = 'Stop'
$f = 'app\details\[type]\[id].tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v311] ERROR: cannot find app\details\[type]\[id].tsx'
    Write-Host '[v311] cd to the frontend root first, then re-run.'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V311_PERF_PROFILER') {
    Write-Host '[v311] guard already present - no-op'
    exit 0
}

# All anchors / replacements use SINGLE-QUOTED here-strings @' ... '@
# which are PowerShell literals (no interpolation, no escaping needed).
$importAnchor = @'
import { useContentStore, getMetaCache, setMetaCache, hydrateMetaFromDisk } from '../../../src/store/contentStore';
'@

$componentAnchor = @'
export default function DetailsScreen() {
'@

if (-not $s.Contains($importAnchor)) {
    Write-Host '[v311] ERROR: import anchor not found in id.tsx'
    Write-Host '       Your id.tsx structure differs from what V311 expects.'
    Write-Host '       Please upload id.tsx to staging so the anchors can be adjusted.'
    exit 2
}
if (-not $s.Contains($componentAnchor)) {
    Write-Host '[v311] ERROR: component anchor not found in id.tsx'
    exit 3
}

$importAddition = @'
import { useContentStore, getMetaCache, setMetaCache, hydrateMetaFromDisk } from '../../../src/store/contentStore';
import { v311Perf } from '../../../src/utils/v311_perf'; // V311_PERF_PROFILER
'@

$componentInjection = @'
export default function DetailsScreen() {
  // V311_PERF_PROFILER - capture details-page lifecycle marks and ship
  // them to the backend /api/debug/perf endpoint for offline analysis.
  v311Perf.start('details');
  v311Perf.mark('MOUNT');
  React.useLayoutEffect(() => { v311Perf.mark('FIRST_RENDER'); }, []);
  React.useEffect(() => {
    v311Perf.mark('FIRST_EFFECT');
    return () => { v311Perf.mark('UNMOUNT'); v311Perf.flush({ reason: 'unmount' }); };
  }, []);
'@

$s2 = $s.Replace($importAnchor, $importAddition).Replace($componentAnchor, $componentInjection)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v311] patched id.tsx - guard V311_PERF_PROFILER now present'
