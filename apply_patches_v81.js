/**
 * apply_patches_v81.js
 * ====================
 * UP-navigation snap fix.
 *
 * Symptom: DOWN works (row title snaps to top), but UP doesn't fully snap
 * — the row appears in the middle of the visible area instead of the top.
 *
 * Root cause: when moving UP to an off-screen row, Android TV runs a
 * LONGER auto-scroll (bigger jump). Our single `requestAnimationFrame`
 * fires before that scroll finishes, so the TV's scroll lands last and
 * wins. We need to run AFTER Android TV is done.
 *
 * Fix: replace single RAF with double RAF (~2 frames / 33ms) — long enough
 * to outlast any platform scroll, fast enough to feel instant.
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v81.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v81] FATAL:', msg); process.exit(1); }
function detectEol(s) { return s.includes('\r\n') ? '\r\n' : '\n'; }
function backupAndWrite(file, src) {
  const b = file + '.bak.v81.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v81]   backup:', b);
}

const CANDIDATES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('app', '(tabs)', 'discover.tsx'),
];
const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('discover.tsx not found.');

let src = fs.readFileSync(file, 'utf8');
const eol = detectEol(src);
console.log('[v81] Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

const marker = '/* DOUBLE_RAF_V81 */';
if (src.includes(marker)) {
  console.log('[v81] Already patched (double-RAF marker present). Nothing to do.');
  process.exit(0);
}

let changed = false;

// 1) handleRowFocus — wrap the existing single-RAF body with another RAF
const rowOld =
  'requestAnimationFrame(() => {' + eol +
  '      scrollViewRef.current?.scrollTo({ y: targetY, animated: false });' + eol +
  '    });';
const rowNew =
  '// ' + marker + eol +
  '    requestAnimationFrame(() => {' + eol +
  '      requestAnimationFrame(() => {' + eol +
  '        scrollViewRef.current?.scrollTo({ y: targetY, animated: false });' + eol +
  '      });' + eol +
  '    });';
if (src.includes(rowOld)) {
  src = src.replace(rowOld, rowNew);
  console.log('[v81]   ✓ handleRowFocus → double-RAF');
  changed = true;
} else {
  console.log('[v81]   ! handleRowFocus single-RAF block not found verbatim — looking for LF variant...');
  // Try LF-only variant as a defensive fallback
  const rowOldLf = rowOld.replace(/\r\n/g, '\n');
  const rowNewLf = rowNew.replace(/\r\n/g, '\n');
  if (src.includes(rowOldLf)) {
    src = src.replace(rowOldLf, rowNewLf);
    console.log('[v81]   ✓ handleRowFocus → double-RAF (LF match)');
    changed = true;
  } else {
    fail('handleRowFocus single-RAF block not found. Did v80 apply?');
  }
}

// 2) handleSectionFocus — wrap its RAF too (best-effort)
const cwOld =
  'requestAnimationFrame(() => {' + eol +
  '        scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: false });' + eol +
  '      });';
const cwNew =
  '// ' + marker + eol +
  '      requestAnimationFrame(() => {' + eol +
  '        requestAnimationFrame(() => {' + eol +
  '          scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: false });' + eol +
  '        });' + eol +
  '      });';
if (src.includes(cwOld)) {
  src = src.replace(cwOld, cwNew);
  console.log('[v81]   ✓ handleSectionFocus → double-RAF');
  changed = true;
} else {
  const cwOldLf = cwOld.replace(/\r\n/g, '\n');
  const cwNewLf = cwNew.replace(/\r\n/g, '\n');
  if (src.includes(cwOldLf)) {
    src = src.replace(cwOldLf, cwNewLf);
    console.log('[v81]   ✓ handleSectionFocus → double-RAF (LF match)');
    changed = true;
  } else {
    console.log('[v81]   ! handleSectionFocus RAF block not found verbatim — skipping (non-fatal).');
  }
}

if (!changed) {
  console.log('[v81] Nothing to change.');
  process.exit(0);
}

backupAndWrite(file, src);
console.log('');
console.log('[v81] ✅ discover.tsx patched.');
console.log('[v81]    Rebuild your APK and test UP/DOWN through several rows.');
console.log('[v81]    Expected: snap-to-top works in BOTH directions, even from off-screen rows.');
