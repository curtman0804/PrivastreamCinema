// apply_patches_v121i_play_loading.js
//
// Shows a full-screen loading overlay the moment the user taps Play, until
// navigation to the player screen takes over. Eliminates the "nothing's
// happening" feel during the 1-3 second backend pre-resolve wait.
//
// Strategy:
//   - Reuse the existing autoPlayOverlay JSX block (used by Play-Next)
//   - Render it whenever a new ref `isInitiatingPlayRef.current` is true
//   - Set the ref true at the top of the Play button's onPress
//   - Force a re-render via a state toggle (since refs alone don't trigger render)
//
// Implementation uses a simple state flag instead of a ref + force update
// for clarity. One useState + one render-condition + one set call.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v121i_play_loading.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'details', '[type]', '[id].tsx');
const MARKER = 'v121i-play-loading';

function die(msg) { console.error('[v121i] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v121i] already applied - nothing to do.');
  process.exit(0);
}

// 1) Add state declaration. Anchor on an existing useState near top of the
// component. We piggyback on autoPlayTriggeredRef which we know exists.
const stateAnchor = /const\s+autoPlayTriggeredRef\s*=\s*useRef\(false\);/;
if (!stateAnchor.test(src)) die('could not find autoPlayTriggeredRef anchor for state injection.');

src = src.replace(
  stateAnchor,
  "const autoPlayTriggeredRef = useRef(false);\n" +
  "  // v121i-play-loading: show full-screen overlay while Play button waits\n" +
  "  const [isInitiatingPlay, setIsInitiatingPlay] = useState(false);"
);

// 2) Wire setIsInitiatingPlay(true) at the top of the Play button's async
// onPress. Anchor on the v121d-play-wait marker comment.
const onPressAnchor = /(\/\* v121d-play-wait \*\/)/;
if (!onPressAnchor.test(src)) die('could not find v121d-play-wait marker for setIsInitiatingPlay injection.');

src = src.replace(
  onPressAnchor,
  "/* v121i-play-loading */\n" +
  "                      setIsInitiatingPlay(true);\n" +
  "                      $1"
);

// 3) Extend the autoPlayOverlay render condition so it also shows when
// isInitiatingPlay is true.
const overlayCondAnchor = /\{autoPlayParam === 'true' && !autoPlayTriggeredRef\.current && \(/;
if (!overlayCondAnchor.test(src)) die('could not find autoPlayOverlay condition anchor.');

src = src.replace(
  overlayCondAnchor,
  "{/* v121i-play-loading */}\n" +
  "      {((autoPlayParam === 'true' && !autoPlayTriggeredRef.current) || isInitiatingPlay) && ("
);

const bak = TARGET + '.bak.v121i';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v121i] patched ' + TARGET);
console.log('[v121i] backup: ' + bak);
console.log('[v121i] OK - rebuild and sideload.');
