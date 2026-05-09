/* eslint-disable */
// apply_patches_v15a.js  — Commentary badge JSX (V13's missing piece)
// Run from project root:   node apply_patches_v15a.js
//
// V13 already destructured isCommentary in StreamCard and added the
// .commentaryBadge / .commentaryBadgeText styles, but its JSX insertion
// failed because of CRLF mismatches. V15-A inserts JUST the badge JSX
// using line-based scanning (CRLF-safe).

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }

const raw = fs.readFileSync(DETAILS, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
const lines = raw.split(/\r?\n/);
const orig = lines.join(eol);
const bak = DETAILS + '.bak.v15a.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

const MARKER = 'PATCH_V15A_COMM_BADGE';

if (orig.includes(MARKER)) {
  ok('Commentary badge already inserted');
} else {
  // Find: <View style={styles.streamBadgeRow}>
  const rowIdx = lines.findIndex(l => /<View\s+style=\{styles\.streamBadgeRow\}>/.test(l));
  if (rowIdx < 0) {
    bad('could not find <View style={styles.streamBadgeRow}> opener');
  } else {
    // Use the indentation of the NEXT non-empty line as our injection indent
    let nextIdx = rowIdx + 1;
    while (nextIdx < lines.length && lines[nextIdx].trim() === '') nextIdx++;
    const indent = (lines[nextIdx].match(/^(\s*)/) || ['', ''])[1] || '          ';

    const badge = [
      indent + '{/* ' + MARKER + ' */}',
      indent + '{isCommentary && (',
      indent + '  <View style={styles.commentaryBadge}>',
      indent + '    <Ionicons name="chatbubble" size={11} color="#FF8C00" />',
      indent + '    <Text style={styles.commentaryBadgeText}>COMM</Text>',
      indent + '  </View>',
      indent + ')}',
    ];

    // Insert immediately AFTER the streamBadgeRow opener line
    lines.splice(rowIdx + 1, 0, ...badge);
    fs.writeFileSync(DETAILS, lines.join(eol), 'utf8');
    ok('inserted COMM badge JSX after streamBadgeRow opener (line ' + (rowIdx + 2) + ')');
    ok('saved ' + DETAILS);
  }
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');
if (fail > 0) {
  console.log('\nFailed. Original is safe in .bak file.');
  process.exit(1);
} else {
  console.log('\nV15-A done. Rebuild — commentary tracks now show an orange COMM badge.');
}
