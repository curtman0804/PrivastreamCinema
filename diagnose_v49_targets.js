/* eslint-disable */
// diagnose_v49_targets.js — Dump exact contents of the 2 files V47/V48
// failed to patch: app/_layout.tsx (whole file) and discover.tsx
// (useFocusEffect + handleItemFocus regions).
//
// Run from repo root:
//   node diagnose_v49_targets.js
//
// Writes v49_targets_dump.txt. Share back.

const fs = require('fs');
const path = require('path');

const out = [];
function w(s) { out.push(s); }

// ------- 1. app/_layout.tsx (full file) -------
const F1 = path.join('frontend', 'app', '_layout.tsx');
w('================================================================');
w('=== FILE: ' + F1);
w('================================================================');
if (!fs.existsSync(F1)) {
  w('  (NOT FOUND)');
} else {
  const raw = fs.readFileSync(F1, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  w('=== TOTAL LINES: ' + lines.length + '   CRLF: ' + (raw.indexOf('\r\n') >= 0));
  w('');
  lines.forEach((l, i) => w(String(i + 1).padStart(4, ' ') + ' | ' + l));
}

// ------- 2. discover.tsx (focused regions) -------
const F2 = path.join('frontend', 'app', '(tabs)', 'discover.tsx');
w('');
w('================================================================');
w('=== FILE: ' + F2);
w('================================================================');
if (!fs.existsSync(F2)) {
  w('  (NOT FOUND)');
} else {
  const raw = fs.readFileSync(F2, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  w('=== TOTAL LINES: ' + lines.length + '   CRLF: ' + (raw.indexOf('\r\n') >= 0));
  w('');

  // Find useFocusEffect region
  const focusStart = lines.findIndex((l) => /useFocusEffect\s*\(/.test(l));
  if (focusStart >= 0) {
    w('--- useFocusEffect region (with 4 lines before + 20 lines after) ---');
    const s = Math.max(0, focusStart - 4);
    const e = Math.min(lines.length, focusStart + 22);
    for (let i = s; i < e; i++) w(String(i + 1).padStart(4, ' ') + ' | ' + lines[i]);
  } else {
    w('--- useFocusEffect NOT FOUND ---');
  }

  // Find handleItemFocus region
  w('');
  const focusHandlerStart = lines.findIndex((l) => /handleItemFocus\s*=/.test(l));
  if (focusHandlerStart >= 0) {
    w('--- handleItemFocus region (with 4 lines before + 18 lines after) ---');
    const s = Math.max(0, focusHandlerStart - 4);
    const e = Math.min(lines.length, focusHandlerStart + 20);
    for (let i = s; i < e; i++) w(String(i + 1).padStart(4, ' ') + ' | ' + lines[i]);
  } else {
    w('--- handleItemFocus NOT FOUND ---');
  }
}

fs.writeFileSync('v49_targets_dump.txt', out.join('\n'), 'utf8');
console.log('Dump written: v49_targets_dump.txt');
console.log('Share that file back so V49 can match your exact anchors.');
