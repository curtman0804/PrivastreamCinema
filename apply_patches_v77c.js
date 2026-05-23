/**
 * apply_patches_v77c.js
 * =====================
 * Companion to v77b. v77b partially patched ContentCard.tsx but failed
 * to inject the StyleSheet entries because the file uses CRLF line
 * endings on Windows. This script just adds the missing styles using
 * a CRLF-tolerant anchor.
 *
 * Idempotent. Safe to re-run.
 *
 * Run from your frontend project root:
 *   node apply_patches_v77c.js
 */

const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  path.join('src', 'components', 'ContentCard.tsx'),
];

const MARKER = 'inCinemasBadge:';

function fail(msg) {
  console.error('[v77c] FATAL:', msg);
  process.exit(1);
}

const file = CANDIDATES.find(p => fs.existsSync(p));
if (!file) fail('Could not find ContentCard.tsx (looked in: ' + CANDIDATES.join(', ') + ')');

let src = fs.readFileSync(file, 'utf8');

if (src.includes(MARKER)) {
  console.log('[v77c] Styles already present. Nothing to do.');
  process.exit(0);
}

const backup = file + '.bak.v77c.' + Date.now();
fs.writeFileSync(backup, src);
console.log('[v77c] Backup:', backup);

// Detect line ending used in this file (CRLF or LF)
const eol = src.includes('\r\n') ? '\r\n' : '\n';
console.log('[v77c] Detected EOL:', eol === '\r\n' ? 'CRLF' : 'LF');

// CRLF-tolerant: find the LAST `});` that closes the StyleSheet block.
// We anchor on the StyleSheet pattern by locating `StyleSheet.create({`
// and then the matching `});` at the end of file.
const styleSheetStart = src.indexOf('StyleSheet.create({');
if (styleSheetStart === -1) fail('Could not locate StyleSheet.create({ — file may be heavily modified.');

// Find the last `});` after styleSheetStart (the closing of StyleSheet.create)
const lastClose = src.lastIndexOf('});');
if (lastClose === -1 || lastClose < styleSheetStart) {
  fail('Could not locate closing }); of StyleSheet block.');
}

const styleBlock =
  `${eol}` +
  `  inCinemasBadge: {${eol}` +
  `    position: 'absolute',${eol}` +
  `    top: 0,${eol}` +
  `    left: 0,${eol}` +
  `    backgroundColor: colors.primary,${eol}` +
  `    paddingHorizontal: 7,${eol}` +
  `    paddingVertical: 3,${eol}` +
  `    borderTopLeftRadius: 3,${eol}` +
  `    borderBottomRightRadius: 6,${eol}` +
  `    zIndex: 5,${eol}` +
  `    elevation: 5,${eol}` +
  `  },${eol}${eol}` +
  `  inCinemasBadgeText: {${eol}` +
  `    color: colors.textPrimary,${eol}` +
  `    fontSize: 9,${eol}` +
  `    fontWeight: '800',${eol}` +
  `    letterSpacing: 0.6,${eol}` +
  `  },${eol}`;

// Insert immediately before the last `});`
const newSrc = src.slice(0, lastClose) + styleBlock + src.slice(lastClose);

fs.writeFileSync(file, newSrc);
console.log('[v77c] ✅ Injected inCinemasBadge styles before closing }); of StyleSheet.');
console.log('[v77c]    File:', file);
console.log('[v77c]    Backup:', backup);
console.log('');
console.log('[v77c] Now press "r" in your Metro terminal to reload.');
