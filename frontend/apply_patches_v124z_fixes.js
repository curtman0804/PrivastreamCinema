// apply_patches_v124z_fixes.js
//
// v124z - cleanup of three bugs introduced by v124x / v124y.
//
//   1) JSX comment leaked into rendered text on the Loading screen.
//      v124x left `/* v124x: was 'Loading next episode...' for series */`
//      OUTSIDE a `{...}` braces block, so JSX renders it as literal text.
//      Fix: strip the comment, leave just `{'Loading...'}`.
//
//   2) Overlay persists when user backs to an episode page.
//      v124y removed the `!autoPlayTriggeredRef.current` gate so the overlay
//      stays up the entire time `autoPlay === 'true'`. When the user backs
//      from /player to the episode page, the param is still 'true' and the
//      overlay covers the episode card.
//      Fix: in the autoplay useEffect, AFTER the autoplay has triggered and
//      we're about to navigate to /player, clear the autoPlay param via
//      router.setParams({autoPlay: ''}). On back, the param is no longer
//      'true', overlay condition is false, episode card shows correctly.
//
//   3) Episode selector still on S1E1 after backing out of an episode.
//      v124x re-keys the FlatList and passes hasTVPreferredFocus={isCurrentEp}
//      to the matching EpisodeCard. But Android TV may not re-evaluate
//      hasTVPreferredFocus when the view is mounted within an already-focused
//      screen. Force it imperatively via a ref + setNativeProps after mount.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124z_fixes.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124z-fixes';

function die(msg) { console.error('[v124z] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124z] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// FIX 1: strip the leaked JSX comment in the Loading text.
// =========================================================================
{
  const oldTxt = "{'Loading...'}  /* v124x: was 'Loading next episode...' for series */";
  const newTxt = "{/* v124z-fixes: was '{'Loading...'}  /* v124x: was ...' */}{'Loading...'}";
  if (src.indexOf(oldTxt) === -1) {
    info('FIX 1: WARN - leaked-comment text not found, may already be clean');
  } else {
    src = src.replace(oldTxt, newTxt);
    info('FIX 1: stripped leaked JSX comment from Loading text');
  }
}

// =========================================================================
// FIX 2: clear autoPlay param after autoplay triggers, so a later back nav
// to this episode page doesn't re-show the overlay.
//
// Anchor: the existing `autoPlayTriggeredRef.current = true;` line inside
// the autoplay useEffect. Insert a router.setParams call right after it
// (before the streams sort + handleStreamSelect setTimeout).
// =========================================================================
{
  const oldLine = "      autoPlayTriggeredRef.current = true;\r\n";
  const newLine = "      autoPlayTriggeredRef.current = true;\r\n" +
"      // v124z-fixes: clear autoPlay param so a future back-nav to this\r\n" +
"      // episode page doesn't re-show the overlay.\r\n" +
"      try { router.setParams({ autoPlay: '' } as any); } catch (_) {}\r\n";
  if (src.indexOf(oldLine) === -1) die('FIX 2: cannot find autoPlayTriggeredRef line');
  src = src.replace(oldLine, newLine);
  info('FIX 2: clear autoPlay param via setParams after autoplay triggers');
}

// =========================================================================
// FIX 3: imperatively focus the matching EpisodeCard after mount.
//
// EpisodeCard already accepts an autoFocus prop (added by v124x). The
// Pressable already has hasTVPreferredFocus={!!autoFocus}. Add a useEffect
// that, when autoFocus is true, calls focus() via ref + setNativeProps
// fallback on Android. This forces the focus to move even after the screen
// was already shown (which is when Android's initial-focus pass is over).
//
// Anchor: the existing useState `const [isFocused, setIsFocused] = useState`
// inside EpisodeCard. Inject useRef + useEffect right after it.
// =========================================================================
{
  const anchor = "const [isFocused, setIsFocused] = useState(false);";
  const idx = src.indexOf(anchor);
  if (idx === -1) die('FIX 3: cannot find EpisodeCard isFocused state');

  const inject = "const [isFocused, setIsFocused] = useState(false);\r\n" +
"  // v124z-fixes: when autoFocus flips true, push focus to this card via\r\n" +
"  // setNativeProps. Backstop for cases where hasTVPreferredFocus isn't\r\n" +
"  // honored because the screen was already focused (e.g., back-nav to root\r\n" +
"  // after setParams updates the selected episode).\r\n" +
"  const pressableRef = useRef<any>(null);\r\n" +
"  useEffect(() => {\r\n" +
"    if (!autoFocus) return;\r\n" +
"    const tries = [60, 200, 500];\r\n" +
"    const timers = tries.map(delay => setTimeout(() => {\r\n" +
"      try {\r\n" +
"        const p: any = pressableRef.current;\r\n" +
"        if (!p) return;\r\n" +
"        // Try the native focus() (works on react-native-tvos / some forks)\r\n" +
"        if (typeof p.focus === 'function') { try { p.focus(); } catch (_) {} }\r\n" +
"        // Backup: setNativeProps with hasTVPreferredFocus\r\n" +
"        try { p.setNativeProps && p.setNativeProps({ hasTVPreferredFocus: true }); } catch (_) {}\r\n" +
"      } catch (_) {}\r\n" +
"    }, delay));\r\n" +
"    return () => { timers.forEach(t => clearTimeout(t)); };\r\n" +
"  }, [autoFocus]);";

  src = src.slice(0, idx) + inject + src.slice(idx + anchor.length);
  info('FIX 3: added autoFocus useEffect to EpisodeCard');

  // Now attach the ref to the Pressable. We added it as a sibling but the
  // original Pressable doesn't have ref={pressableRef}. Add it.
  const pressOld = "    <Pressable\r\n      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\r\n      onPress={onPress}\r\n      onLongPress={isWatched ? onMarkUnwatched : undefined}\r\n      onFocus={() => setIsFocused(true)}\r\n      onBlur={() => setIsFocused(false)}\r\n      delayLongPress={600}\r\n      hasTVPreferredFocus={!!autoFocus}\r\n    >";
  const pressNew = "    <Pressable\r\n      ref={pressableRef}\r\n      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\r\n      onPress={onPress}\r\n      onLongPress={isWatched ? onMarkUnwatched : undefined}\r\n      onFocus={() => setIsFocused(true)}\r\n      onBlur={() => setIsFocused(false)}\r\n      delayLongPress={600}\r\n      hasTVPreferredFocus={!!autoFocus}\r\n    >";
  if (src.indexOf(pressOld) === -1) die('FIX 3: cannot find EpisodeCard Pressable to attach ref');
  src = src.replace(pressOld, pressNew);
  info('FIX 3: attached ref to EpisodeCard Pressable');
}

// =========================================================================
// Sanity: useRef and useEffect must be importable. They likely are already
// imported. Verify and add if missing.
// =========================================================================
{
  const reactImport = /import\s+React,\s*\{([^}]*)\}\s*from\s*['"]react['"];/;
  const m = src.match(reactImport);
  if (m) {
    const have = m[1].split(',').map(s => s.trim()).filter(Boolean);
    let changed = false;
    if (!have.includes('useRef'))    { have.push('useRef');    changed = true; }
    if (!have.includes('useEffect')) { have.push('useEffect'); changed = true; }
    if (changed) {
      const newImport = 'import React, { ' + have.join(', ') + " } from 'react';";
      src = src.replace(reactImport, newImport);
      info('added useRef/useEffect to React imports');
    } else {
      info('useRef/useEffect already imported');
    }
  } else {
    info('WARN: could not find React import to verify - assuming hooks available');
  }
}

const bak = DETAILS + '.bak.v124z';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload.');
info('Expected:');
info('  - Loading screen: clean "Loading..." text');
info('  - Back from player to episode page: episode card visible (no stale overlay)');
info('  - Back from episode page to root: selector lands on the watched episode');
