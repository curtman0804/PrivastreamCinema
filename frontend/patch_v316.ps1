# patch_discover_tsx_v316_cw_short_scroll_rescue.ps1
# V316 - Rescue the "first UP press lands in CW row visually but no poster
# fires onFocus" case.  When scroll settles below y=150 (above Popular
# Movies) AND lastFocusedSection isn't already '__cw__', fire
# handleSectionFocus('__cw__') to snap the rest of the way and reassert
# focus on the CW row.  Eliminates the double-UP press requirement.

$ErrorActionPreference = 'Stop'
$f = 'app\(tabs)\discover.tsx'

if (-not (Test-Path -LiteralPath $f)) {
    Write-Host '[v316] ERROR: cannot find app\(tabs)\discover.tsx'
    exit 1
}

$s = Get-Content -Raw -LiteralPath $f
if ($s -match 'V316_CW_SHORT_SCROLL_RESCUE') {
    Write-Host '[v316] guard already present - no-op'
    exit 0
}

$anchor = @'
          onScroll={(e) => {
            const y = e.nativeEvent?.contentOffset?.y ?? 0;
            const lockUntil = cwFocusLockUntilRef.current || 0;
            const inLock = Date.now() < lockUntil;
            if (y > 0) {
              console.log('[V279_DIAG] onScroll y=' + y.toFixed(1) + ' inLock=' + inLock + ' t=' + Date.now());
            }
            if (inLock && y > 0 && scrollViewRef.current) {
              scrollViewRef.current.scrollTo({ y: 0, animated: false });
              console.log('[V279_DIAG]   → SNAP BACK to 0');
            }
          }}
'@

$replacement = @'
          onScroll={(e) => {
            const y = e.nativeEvent?.contentOffset?.y ?? 0;
            const lockUntil = cwFocusLockUntilRef.current || 0;
            const inLock = Date.now() < lockUntil;
            if (y > 0) {
              console.log('[V279_DIAG] onScroll y=' + y.toFixed(1) + ' inLock=' + inLock + ' t=' + Date.now());
            }
            if (inLock && y > 0 && scrollViewRef.current) {
              scrollViewRef.current.scrollTo({ y: 0, animated: false });
              console.log('[V279_DIAG]   → SNAP BACK to 0');
            }
            // V316_CW_SHORT_SCROLL_RESCUE — when the Android TV focus engine
            // partially scrolls the CW row into view but doesn't deliver
            // onFocus to a specific poster, scroll settles below y=150 and
            // the selector stays stuck on Popular Movies — forcing the user
            // to press UP twice.  Detect this by waiting 250ms after the
            // last onScroll event, then if y is in the CW range (>0 and
            // <150) and the lock isn't already engaged and CW isn't the
            // current section, fire handleSectionFocus('__cw__') to snap
            // home and reassert focus on CW.
            try {
              if ((v316CwRescueTimer as any).current) {
                clearTimeout((v316CwRescueTimer as any).current);
              }
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
            } catch (_) { /* ignore */ }
          }}
'@

if (-not $s.Contains($anchor)) {
    Write-Host '[v316] ERROR: onScroll anchor not found - discover.tsx may have drifted'
    exit 2
}

$s2 = $s.Replace($anchor, $replacement)

# Add the rescue timer ref alongside the existing cwFocusLockUntilRef
$refAnchor = 'const cwFocusLockUntilRef = useRef<number>(0);'
$refReplacement = @'
const cwFocusLockUntilRef = useRef<number>(0);
  // V316_CW_SHORT_SCROLL_RESCUE - debounce timer for the post-settle check
  const v316CwRescueTimer = useRef<any>(null);
'@
if (-not $s2.Contains($refAnchor)) {
    Write-Host '[v316] ERROR: cwFocusLockUntilRef anchor not found'
    exit 3
}
$s2 = $s2.Replace($refAnchor, $refReplacement)

Set-Content -LiteralPath $f -Value $s2 -NoNewline -Encoding UTF8

Write-Host '[v316] patched discover.tsx - guard V316_CW_SHORT_SCROLL_RESCUE now present'
Write-Host '[v316] first UP press from Popular Movies will now reliably land on CW row'
