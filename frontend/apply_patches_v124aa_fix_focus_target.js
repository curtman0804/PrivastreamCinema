// apply_patches_v124aa_fix_focus_target.js
//
// v124aa - undo v124z's misplaced useEffect and put it in the right component.
//
// v124z FIX 3 targeted the FIRST `const [isFocused, setIsFocused] = useState`
// in the file, which lives in an unrelated TV focus wrapper (around line 90).
// That component doesn't have an `autoFocus` prop in scope - undefined ref ->
// runtime crash on render of details screen.
//
// This patch:
//   A) Removes the wrongly-placed useRef + useEffect block from that earlier
//      component, and removes the `ref={pressableRef}` line from THAT
//      component if it got attached there too.
//   B) Adds the same useRef + useEffect to the ACTUAL EpisodeCard component,
//      and attaches `ref={pressableRef}` to its Pressable.
//
// EpisodeCard is anchored by its prop-destructuring signature so we can't
// pick the wrong component this time.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124aa_fix_focus_target.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124aa-fix-focus-target';

function die(msg) { console.error('[v124aa] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124aa] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// =========================================================================
// STEP 1: Remove the misplaced v124z useRef + useEffect block.
// Anchor: the unique comment "v124z-fixes: when autoFocus flips true".
// Walk back to the line "const pressableRef = useRef<any>(null);" and
// forward to the deps array "}, [autoFocus]);".
// =========================================================================
{
  const startMarker = "  // v124z-fixes: when autoFocus flips true, push focus to this card via";
  const sIdx = src.indexOf(startMarker);
  if (sIdx === -1) {
    info('STEP 1: misplaced block not found (already cleaned?) - skipping');
  } else {
    const endKey = "}, [autoFocus]);";
    const eIdx = src.indexOf(endKey, sIdx);
    if (eIdx === -1) die('STEP 1: cannot find end of misplaced useEffect');
    const blockEnd = eIdx + endKey.length;
    // Also swallow the trailing newline after the deps array.
    let after = blockEnd;
    if (src[after] === '\r') after++;
    if (src[after] === '\n') after++;
    src = src.slice(0, sIdx) + src.slice(after);
    info('STEP 1: removed misplaced v124z useRef+useEffect block');
  }
}

// =========================================================================
// STEP 2: ALSO remove `ref={pressableRef}` from the wrongly-patched Pressable
// if it got attached there. The first Pressable in the file is in the wrong
// component but I only patched EpisodeCard's Pressable in v124z - let me
// check both.
//
// Strategy: any Pressable line `      ref={pressableRef}\r\n` that ISN'T
// followed within ~15 lines by the EpisodeCard style key "styles.episodeCard"
// is in the wrong component and should be removed.
//
// Simpler: just look for the EpisodeCard Pressable pattern and ensure that's
// the only place ref={pressableRef} appears. If we find ANY ref={pressableRef}
// occurrences, we'll surgically check + remove the bad ones in step 3.
// =========================================================================
{
  const refLine = "      ref={pressableRef}\r\n";
  const occurrences = [];
  let idx = src.indexOf(refLine);
  while (idx !== -1) {
    occurrences.push(idx);
    idx = src.indexOf(refLine, idx + 1);
  }
  info('STEP 2: found ' + occurrences.length + ' ref={pressableRef} occurrences');

  // For each, look at the next ~600 chars to see if styles.episodeCard appears.
  // If NOT, this is a wrongly-attached ref - remove it.
  // Walk backwards so indexes don't shift.
  for (let i = occurrences.length - 1; i >= 0; i--) {
    const start = occurrences[i];
    const window = src.slice(start, start + 800);
    if (window.indexOf('styles.episodeCard') === -1) {
      src = src.slice(0, start) + src.slice(start + refLine.length);
      info('STEP 2: removed wrongly-attached ref={pressableRef} at offset ' + start);
    } else {
      info('STEP 2: kept ref={pressableRef} at offset ' + start + ' (EpisodeCard - correct)');
    }
  }
}

// =========================================================================
// STEP 3: ADD the useRef + useEffect to EpisodeCard correctly.
// Anchor: the EpisodeCard function signature (uniquely identifies it).
// Then find its first `const [isFocused, setIsFocused] = useState(false);`
// occurrence after the signature, and inject after it.
// =========================================================================
{
  const sigAnchor = "function EpisodeCard({";
  const sigIdx = src.indexOf(sigAnchor);
  if (sigIdx === -1) die('STEP 3: cannot find EpisodeCard signature');

  const useStateInside = src.indexOf('const [isFocused, setIsFocused] = useState(false);', sigIdx);
  if (useStateInside === -1) die('STEP 3: cannot find isFocused useState inside EpisodeCard');
  const useStateEnd = useStateInside + 'const [isFocused, setIsFocused] = useState(false);'.length;

  // Check: was this already injected by another patch?
  const next200 = src.slice(useStateEnd, useStateEnd + 200);
  if (next200.indexOf('pressableRef') !== -1) {
    info('STEP 3: useRef already injected in EpisodeCard - skipping');
  } else {
    const inject = "\r\n  // v124aa-fix-focus-target: imperative focus for the matching episode card.\r\n" +
"  const pressableRef = useRef<any>(null);\r\n" +
"  useEffect(() => {\r\n" +
"    if (!autoFocus) return;\r\n" +
"    const tries = [60, 200, 500];\r\n" +
"    const timers = tries.map(delay => setTimeout(() => {\r\n" +
"      try {\r\n" +
"        const p: any = pressableRef.current;\r\n" +
"        if (!p) return;\r\n" +
"        if (typeof p.focus === 'function') { try { p.focus(); } catch (_) {} }\r\n" +
"        try { p.setNativeProps && p.setNativeProps({ hasTVPreferredFocus: true }); } catch (_) {}\r\n" +
"      } catch (_) {}\r\n" +
"    }, delay));\r\n" +
"    return () => { timers.forEach(t => clearTimeout(t)); };\r\n" +
"  }, [autoFocus]);";
    src = src.slice(0, useStateEnd) + inject + src.slice(useStateEnd);
    info('STEP 3: injected useRef+useEffect inside EpisodeCard');
  }
}

// =========================================================================
// STEP 4: Attach ref={pressableRef} to EpisodeCard's Pressable. Anchor via
// the styles.episodeCard reference.
// =========================================================================
{
  const pressOld = "    <Pressable\r\n      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\r\n      onPress={onPress}";
  const pressNew = "    <Pressable\r\n      ref={pressableRef}\r\n      style={[styles.episodeCard, isFocused && styles.episodeCardFocused]}\r\n      onPress={onPress}";

  // Check if already attached.
  if (src.indexOf(pressNew) !== -1) {
    info('STEP 4: ref already attached to EpisodeCard Pressable');
  } else {
    if (src.indexOf(pressOld) === -1) die('STEP 4: cannot find EpisodeCard Pressable opening');
    src = src.replace(pressOld, pressNew);
    info('STEP 4: attached ref={pressableRef} to EpisodeCard Pressable');
  }
}

const bak = DETAILS + '.bak.v124aa';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload. Crash on poster click should be fixed.');
