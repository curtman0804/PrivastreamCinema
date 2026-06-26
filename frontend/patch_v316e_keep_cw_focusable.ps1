# patch_v316e_keep_cw_focusable.ps1
# V316e - Disable removeClippedSubviews on the outer Discover ScrollView so
# the Continue-Watching row stays in the native Android view hierarchy
# even when scrolled offscreen.  Without this fix, the CW poster's native
# tag (captured by V316d as tag=250) gets removed from the focusable view
# tree when the user scrolls down to Popular Movies — Android TV's
# nextFocusUp=250 then resolves to nothing and silently falls through.
#
# Perf impact: minimal.  The inner per-row FlatLists are still virtualized
# (their own removeClippedSubviews stays true), and the LazyMount stagger
# already prevents all rows from mounting at once.  We're only keeping
# native View shells around, not their poster bitmaps.
#
# Touches only discover.tsx.

$ErrorActionPreference = 'Stop'
$f = 'app\(tabs)\discover.tsx'

if (-not (Test-Path -LiteralPath $f)) {
  Write-Host '[v316e] ERROR: cannot find app\(tabs)\discover.tsx'
  exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V316e_KEEP_CW_FOCUSABLE') {
  Write-Host '[v316e] already patched, skipping'
  exit 0
}

$bad = @'
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          removeClippedSubviews={true}
'@

$good = @'
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          // V316e_KEEP_CW_FOCUSABLE — was true; flipped to false so the
          // Continue-Watching row stays in Android's focusable view tree
          // when scrolled offscreen.  Required so nextFocusUp on row-0
          // ContentCards can resolve to the CW poster's native tag.
          removeClippedSubviews={false}
'@

if (-not $s.Contains($bad)) {
  Write-Host '[v316e] ERROR: outer ScrollView removeClippedSubviews anchor not found'
  exit 2
}

$s2 = $s.Replace($bad, $good)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v316e] discover.tsx patched - V316e_KEEP_CW_FOCUSABLE marker now present'
Write-Host '[v316e] After deploy_ota.bat + app restart, single UP press from Popular Movies'
Write-Host '[v316e] should now move the gold border directly to the first Continue Watching poster.'
