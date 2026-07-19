# patch_v342_cw_row_right_edge.ps1
# Prevents the horizontal Continue Watching row from spilling focus down
# into the next row when the user presses RIGHT on the last CW card.
#
# Fix: pass an `isLast` prop to the last CW poster. When true, set
# nextFocusRight to the poster's own native handle so Android TV's focus
# search doesn't fall through to another view below.

$ErrorActionPreference = 'Stop'
$Target = 'C:\Users\Curtm\PrivastreamCinema\frontend\app\(tabs)\discover.tsx'

Write-Host "[V342] Patching $Target" -ForegroundColor Cyan
if (-not (Test-Path -LiteralPath $Target)) { Write-Host "ERROR: not found" -ForegroundColor Red; exit 1 }

$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
Copy-Item -LiteralPath $Target -Destination "$Target.bak_v342_$stamp" -Force

$content = Get-Content -LiteralPath $Target -Raw

if ($content -match 'V342_CW_LAST_INDEX') {
  Write-Host "[V342] Already patched. Skipping." -ForegroundColor Yellow; exit 0
}

# ------- 1) renderContinueWatchingItem: pass isLast to last card -------
$old1 = @'
const renderContinueWatchingItem = useCallback(
  ({ item }: { item: WatchProgress }) => (
    <ContinueWatchingItem
      item={item}
      posterWidth={POSTER_WIDTH}
      posterHeight={POSTER_HEIGHT}
      isTV={isTV}
      onPress={() => handleContinueWatchingPress(item)}
      onRemove={() => handleRemoveFromContinueWatching(item)}
      onSectionFocus={() => handleSectionFocus('__cw__')}
    />
  ),
  [isTV]
);
'@

$new1 = @'
// V342_CW_LAST_INDEX - stable ref to CW list length so renderer knows
// which card is the last one (for right-edge focus containment).
const _v342CwLenRef = useRef(0);
useEffect(() => {
  const list = (continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW;
  _v342CwLenRef.current = list ? list.length : 0;
}, [continueWatching, cachedCW]);

const renderContinueWatchingItem = useCallback(
  ({ item, index }: { item: WatchProgress; index: number }) => (
    <ContinueWatchingItem
      item={item}
      posterWidth={POSTER_WIDTH}
      posterHeight={POSTER_HEIGHT}
      isTV={isTV}
      isLast={index === Math.max(0, (_v342CwLenRef.current - 1))}
      onPress={() => handleContinueWatchingPress(item)}
      onRemove={() => handleRemoveFromContinueWatching(item)}
      onSectionFocus={() => handleSectionFocus('__cw__')}
    />
  ),
  [isTV]
);
'@

if ($content.Contains($old1)) {
  $content = $content.Replace($old1, $new1)
  Write-Host "  renderContinueWatchingItem updated (isLast prop)" -ForegroundColor Green
} else {
  Write-Host "  ERROR: renderContinueWatchingItem anchor not found" -ForegroundColor Red
  exit 1
}

# ------- 2) ContinueWatchingItem signature: accept isLast -------
$old2 = @'
function ContinueWatchingItem({ 
  item, 
  posterWidth, 
  posterHeight, 
  isTV, 
  onPress, 
  onRemove,
  onSectionFocus,
}: { 
  item: WatchProgress; 
  posterWidth: number; 
  posterHeight: number; 
  isTV: boolean;
  onPress: () => void;
  onRemove: () => void;
  onSectionFocus?: () => void;
}) {
'@

$new2 = @'
function ContinueWatchingItem({ 
  item, 
  posterWidth, 
  posterHeight, 
  isTV, 
  isLast,
  onPress, 
  onRemove,
  onSectionFocus,
}: { 
  item: WatchProgress; 
  posterWidth: number; 
  posterHeight: number; 
  isTV: boolean;
  isLast?: boolean;
  onPress: () => void;
  onRemove: () => void;
  onSectionFocus?: () => void;
}) {
'@

if ($content.Contains($old2)) {
  $content = $content.Replace($old2, $new2)
  Write-Host "  ContinueWatchingItem signature updated (isLast prop)" -ForegroundColor Green
} else {
  Write-Host "  ERROR: ContinueWatchingItem signature anchor not found" -ForegroundColor Red
  exit 1
}

# ------- 3) Poster Pressable: add nextFocusRight self-block when isLast -------
# Insert right after `ref={posterRef}` on the poster Pressable.
$old3 = @'
      <Pressable
        ref={posterRef}
        onPress={_v176bOnPress}
'@

$new3 = @'
      <Pressable
        ref={posterRef}
        // V342_CW_RIGHT_EDGE - when this is the last CW card, block RIGHT
        // navigation from falling through into the row below by pointing
        // nextFocusRight at our own native handle (self-loop).
        {...(isLast && posterTag ? { nextFocusRight: posterTag } : {})}
        onPress={_v176bOnPress}
'@

if ($content.Contains($old3)) {
  $content = $content.Replace($old3, $new3)
  Write-Host "  Poster Pressable nextFocusRight self-block added" -ForegroundColor Green
} else {
  Write-Host "  ERROR: Poster Pressable anchor not found" -ForegroundColor Red
  exit 1
}

Set-Content -LiteralPath $Target -Value $content -NoNewline
Write-Host "[V342] Done. Run deploy_ota.bat next." -ForegroundColor Cyan
