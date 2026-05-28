// apply_patches_v124ab_inject_useref.js
//
// v124ab - finish what v124aa skipped: inject `const pressableRef = useRef(null)`
// + the focus-retry useEffect into EpisodeCard.
//
// v124aa's "already injected" check fired a false positive because it searched
// for the string "pressableRef" in the next 200 chars after the useState,
// and the JSX `ref={pressableRef}` line satisfied that. So the declaration
// was never added -> `pressableRef` is undefined in EpisodeCard's scope ->
// render crashes when an episode card is rendered.
//
// This patch:
//   - Uses a tighter check for `const pressableRef = useRef` (declaration,
//     not just reference).
//   - Injects the declaration + useEffect right after EpisodeCard's
//     `const [thumbError, setThumbError] = useState(false);` (unique line
//     inside EpisodeCard).
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124ab_inject_useref.js

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v124ab-inject-useref';

function die(msg) { console.error('[v124ab] FAIL: ' + msg); process.exit(1); }
function info(msg) { console.log('[v124ab] ' + msg); }

if (!fs.existsSync(DETAILS)) die('cannot find ' + DETAILS);
let src = fs.readFileSync(DETAILS, 'utf8');

if (src.includes(MARKER)) { info('already applied - nothing to do.'); process.exit(0); }

// Tight check: is the declaration actually present?
if (/const\s+pressableRef\s*=\s*useRef/.test(src)) {
  info('declaration already present - nothing to do.');
  process.exit(0);
}

// Anchor: unique to EpisodeCard.
const anchor = '  const [thumbError, setThumbError] = useState(false);';
const aIdx = src.indexOf(anchor);
if (aIdx === -1) die('cannot find EpisodeCard thumbError useState anchor');
const aEnd = aIdx + anchor.length;

const inject = "\r\n  // v124ab-inject-useref: declare pressableRef + retry-focus effect for EpisodeCard.\r\n" +
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

src = src.slice(0, aEnd) + inject + src.slice(aEnd);
info('injected pressableRef declaration + autoFocus useEffect into EpisodeCard');

const bak = DETAILS + '.bak.v124ab';
if (!fs.existsSync(bak)) fs.copyFileSync(DETAILS, bak);
fs.writeFileSync(DETAILS, src, 'utf8');
info('patched ' + DETAILS);
info('OK - rebuild and sideload. Crash on poster click should be fixed.');
