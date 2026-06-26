# patch_discover_tsx_v316b_event_capture_fix.ps1
# V316b - Fix the V316 closure bug.  The setTimeout was re-reading
# e.nativeEvent.contentOffset.y INSIDE the closure, but React Native pools
# synthetic events and nulls the nativeEvent reference by the time the
# 250ms timeout fires - so ny was always 0 and the rescue never ran.
# Capture y synchronously in the outer scope and reference it instead.

$ErrorActionPreference = 'Stop'
$f = 'app\(tabs)\discover.tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v316b] ERROR: cannot find app\(tabs)\discover.tsx'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V316b_EVENT_CAPTURE_FIX') {
    Write-Host '[v316b] guard already present - no-op'
    exit 0
}

$bad = @'
              (v316CwRescueTimer as any).current = setTimeout(() => {
                const ny = (e.nativeEvent && e.nativeEvent.contentOffset && e.nativeEvent.contentOffset.y) || 0;
                const stillInCwRange = ny > 0 && ny < 150;
                const stillNotCw = lastFocusedSection.current !== '__cw__';
                const lockClear = Date.now() >= (cwFocusLockUntilRef.current || 0);
                if (stillInCwRange && stillNotCw && lockClear) {
                  console.log('[V316_RESCUE] settle y=' + ny + ' not in __cw__ - snapping');
                  handleSectionFocus('__cw__');
                }
              }, 250);
'@

$good = @'
              // V316b_EVENT_CAPTURE_FIX - capture y in OUTER scope (already
              // done as `const y` above) and reference it; do NOT re-read
              // e.nativeEvent inside the closure (React Native pools the
              // synthetic event and nulls .nativeEvent before the timeout
              // fires, causing ny=0 and the rescue to silently no-op).
              const capturedY = y;
              (v316CwRescueTimer as any).current = setTimeout(() => {
                const stillInCwRange = capturedY > 0 && capturedY < 150;
                const stillNotCw = lastFocusedSection.current !== '__cw__';
                const lockClear = Date.now() >= (cwFocusLockUntilRef.current || 0);
                if (stillInCwRange && stillNotCw && lockClear) {
                  console.log('[V316_RESCUE] settle y=' + capturedY + ' not in __cw__ - snapping');
                  handleSectionFocus('__cw__');
                }
              }, 250);
'@

if (-not $s.Contains($bad)) {
    Write-Host '[v316b] ERROR: V316 buggy block not found - was V316 actually applied?'
    Write-Host '       Run patch_discover_tsx_v316_cw_short_scroll_rescue.ps1 first.'
    exit 2
}

$s2 = $s.Replace($bad, $good)
Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v316b] patched discover.tsx - guard V316b_EVENT_CAPTURE_FIX now present'
Write-Host '[v316b] CW rescue setTimeout closure now references captured y, not pooled event'
