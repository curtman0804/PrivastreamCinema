# patch_v343_nav_back_focus_diag.ps1
# Adds diagnostic logging so the next time nav-back focus lands in the wrong
# place we get a clean trace to root-cause it. No behavior change.
#
# Adds 3 log tags:
#   [V343 NAV_BACK] focus effect fired
#   [V343 NAV_BACK] first section focus after nav-back t+Xms key=<X>
#   [V343 NAV_BACK] first item focus after nav-back t+Xms id=<Y>
#
# Any focus event within 800ms of the useFocusEffect firing is likely
# part of the auto-restore. If the log shows a section/item that isn't
# where the user was before they navigated to details -> that's the bug.

$ErrorActionPreference = 'Stop'
$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\(tabs)\discover.tsx'

Write-Host "[V343] Patching $Target" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Target)) { Write-Host "ERROR: not found" -ForegroundColor Red; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $Target -Destination "$Target.bak_v343_$stamp" -Force

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V343_NAV_BACK_DIAG') {
  Write-Host "[V343] Already patched. Skipping." -ForegroundColor Yellow; exit 0
}

# --- 1) Log nav-back timestamp in useFocusEffect ---
$old1 = @'
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const cwElapsed = now - lastCWFetchTime.current;
      const discoverElapsed = now - lastDiscoverFetchTime.current;
'@

$new1 = @'
  // V343_NAV_BACK_DIAG - stamp the moment discover regains focus so we can
  // correlate any weird focus jumps that happen right after nav-back.
  const _v343NavBackAt = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      _v343NavBackAt.current = now;
      console.log('[V343 NAV_BACK] focus effect fired t=' + now);
      const cwElapsed = now - lastCWFetchTime.current;
      const discoverElapsed = now - lastDiscoverFetchTime.current;
'@

if ($content.Contains($old1)) {
  $content = $content.Replace($old1, $new1)
  Write-Host "  useFocusEffect nav-back stamp added" -ForegroundColor Green
} else {
  Write-Host "  WARN: useFocusEffect anchor not found - manual check needed" -ForegroundColor Yellow
}

# --- 2) Log first section-focus within 800ms of nav-back ---
$old2 = "console.log('[V279_DIAG] handleSectionFocus key=' + sectionKey + ' t=' + Date.now());"
$new2 = @'
console.log('[V279_DIAG] handleSectionFocus key=' + sectionKey + ' t=' + Date.now());
    { const _v343dt = Date.now() - (_v343NavBackAt.current || 0); if (_v343dt >= 0 && _v343dt < 800) console.log('[V343 NAV_BACK] first section focus t+' + _v343dt + 'ms key=' + sectionKey); }
'@

if ($content.Contains($old2)) {
  $content = $content.Replace($old2, $new2)
  Write-Host "  handleSectionFocus nav-back diag added" -ForegroundColor Green
} else {
  Write-Host "  WARN: handleSectionFocus V279_DIAG line not found" -ForegroundColor Yellow
}

# --- 3) Log first item-focus within 800ms of nav-back ---
# Find handleItemFocus callback opening and inject at the top of its body.
$old3 = 'const handleItemFocus = useCallback((item: ContentItem) => {'
$new3 = @'
const handleItemFocus = useCallback((item: ContentItem) => {
    { const _v343dt = Date.now() - (_v343NavBackAt.current || 0); if (_v343dt >= 0 && _v343dt < 800) console.log('[V343 NAV_BACK] first item focus t+' + _v343dt + 'ms id=' + String((item as any)?.id || (item as any)?.imdb_id || '?')); }
'@

if ($content.Contains($old3)) {
  $content = $content.Replace($old3, $new3)
  Write-Host "  handleItemFocus nav-back diag added" -ForegroundColor Green
} else {
  Write-Host "  WARN: handleItemFocus anchor not found" -ForegroundColor Yellow
}

Set-Content -LiteralPath $Target -Value $content -NoNewline
Write-Host "[V343] Done. Run deploy_ota.bat next." -ForegroundColor Cyan
