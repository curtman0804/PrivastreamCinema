// apply_patches_v124f_hardware_back.js
//
// Registers a BackHandler in app/player.tsx so hardware Back (remote /
// Android back button) flows through handleBack(). Without this, the
// hardware back fires the system goBack() which bypasses v124b's
// series-aware contextual routing, sending the user back through every
// intermediate episode page instead of jumping to the show root.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124f_hardware_back.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'player.tsx');
const MARKER = 'v124f-hardware-back';

function die(msg) { console.error('[v124f] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET + ' - run from frontend root.');

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v124f] already applied - nothing to do.');
  process.exit(0);
}

// 1) Add BackHandler to the existing react-native import.
const importRe = /import\s+\{\s*Modal,\s*FlatList\s*\}\s+from\s+['"]react-native['"];/;
if (!importRe.test(src)) die('could not find Modal/FlatList react-native import.');

src = src.replace(
  importRe,
  "import { Modal, FlatList, BackHandler } from 'react-native';"
);

// 2) Add a useEffect that wires hardwareBackPress -> handleBack. Inject
// immediately after the v124b handleBack closing brace.
const handleBackRe = /(\/\/ v124b-back-contextual: contextual back from player\.[\s\S]*?router\.back\(\);\s*[\r\n]+\s*\};)/;
if (!handleBackRe.test(src)) die('could not find v124b handleBack closing brace.');

const injection = `

  // v124f-hardware-back: route the hardware Back button through handleBack
  // so it follows the same series-aware logic as the on-screen Back button.
  React.useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      try {
        handleBack();
      } catch (e) {
        console.log('[PLAYER] v124f hardwareBack error', e);
        return false; // let system back handle it
      }
      return true; // we handled it
    });
    return () => sub.remove();
  }, [handleBack]);`;

src = src.replace(handleBackRe, "$1" + injection);

// 3) Make sure React default import exists (it does already for hooks).
if (!/^import\s+React\b/m.test(src) && !/from\s+['"]react['"]/.test(src)) {
  die('React import not found in player.tsx - cannot use React.useEffect.');
}

const bak = TARGET + '.bak.v124f';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v124f] patched ' + TARGET);
console.log('[v124f] backup: ' + bak);
console.log('[v124f] OK - rebuild and sideload.');
