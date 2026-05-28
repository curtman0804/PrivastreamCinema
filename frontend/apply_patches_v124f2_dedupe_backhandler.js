// apply_patches_v124f2_dedupe_backhandler.js
//
// Removes the duplicate BackHandler import that v124f added when
// BackHandler was already imported from react-native in another line.
//
// Run from FRONTEND root (CMD):
//   node apply_patches_v124f2_dedupe_backhandler.js

const fs = require('fs');
const path = require('path');

const TARGET = path.join('app', 'player.tsx');

function die(msg) { console.error('[v124f2] FAIL: ' + msg); process.exit(1); }
if (!fs.existsSync(TARGET)) die('cannot find ' + TARGET);

let src = fs.readFileSync(TARGET, 'utf8');

// Step 1: revert the modified Modal/FlatList/BackHandler import on line 38
// back to just Modal, FlatList.
const dupeImportRe = /import \{ Modal, FlatList, BackHandler \} from 'react-native';/;
if (dupeImportRe.test(src)) {
  src = src.replace(dupeImportRe, "import { Modal, FlatList } from 'react-native';");
  console.log('[v124f2] reverted duplicate BackHandler import on Modal/FlatList line');
}

// Step 2: make sure BackHandler IS imported somewhere. If not, add it to the
// FIRST react-native import that doesn't already have it.
if (!/\bBackHandler\b/.test(src.split('\n').slice(0, 100).join('\n'))) {
  const anyRnImportRe = /import \{([^}]*)\} from ['"]react-native['"];/;
  const m = src.match(anyRnImportRe);
  if (!m) die('no react-native import to add BackHandler into.');
  const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
  if (!names.includes('BackHandler')) {
    names.push('BackHandler');
    src = src.replace(anyRnImportRe, `import { ${names.join(', ')} } from 'react-native';`);
    console.log('[v124f2] added BackHandler to the first react-native import');
  }
}

const bak = TARGET + '.bak.v124f2';
if (!fs.existsSync(bak)) fs.copyFileSync(TARGET, bak);

fs.writeFileSync(TARGET, src, 'utf8');
console.log('[v124f2] patched ' + TARGET);
console.log('[v124f2] backup: ' + bak);
console.log('[v124f2] OK - rebuild and sideload.');
