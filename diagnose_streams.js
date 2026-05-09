/* eslint-disable */
// diagnose_streams.js — READ-ONLY diagnostic. Makes ZERO file changes.
// Run from project root:   node diagnose_streams.js
//
// Prints the current state of sortStreamsByLanguage and the play-button
// onPress handler so we can see what patches actually applied and what
// the stream selection logic looks like right now.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
if (!fs.existsSync(DETAILS)) {
  console.log('FAIL: ' + DETAILS + ' not found. Run from C:\\Users\\Curtm\\PrivastreamCinema');
  process.exit(1);
}

const src = fs.readFileSync(DETAILS, 'utf8');
const lines = src.split(/\r?\n/);

console.log('\n========================================');
console.log('  DIAGNOSTIC — sortStreamsByLanguage');
console.log('========================================');
console.log('File: ' + DETAILS);
console.log('Size: ' + src.length + ' bytes, ' + lines.length + ' lines\n');

// Patch markers present?
const markers = [
  'PATCH_V9_SCORE_BASED_SORT',
  'PATCH_V11_PARSE_CACHE',
  'PATCH_V11A_PARSE_CACHE_RETRY',
  'PATCH_V12_COMMENTARY_DETECT',
  'PATCH_V12_COMMENTARY_PENALTY',
  'PATCH_V13_COMM_BADGE',
  'PATCH_V15A_COMMENTARY_BADGE',
  'PATCH_V16_COMMENTARY_SINK',
  'PATCH_V16A_COMMENTARY_SINK',
];
console.log('--- Patch markers found ---');
for (const m of markers) {
  console.log((src.includes(m) ? '  ✓ ' : '  ✗ ') + m);
}

// Dump sortStreamsByLanguage body
console.log('\n--- sortStreamsByLanguage body ---');
const fnStart = lines.findIndex(l => l.includes('function sortStreamsByLanguage'));
if (fnStart < 0) {
  console.log('  FAIL: could not find function declaration');
} else {
  // Find matching close brace by tracking depth
  let depth = 0, fnEnd = -1, sawOpen = false;
  for (let i = fnStart; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === '{') { depth++; sawOpen = true; }
      else if (ch === '}') { depth--; if (sawOpen && depth === 0) { fnEnd = i; break; } }
    }
    if (fnEnd >= 0) break;
  }
  if (fnEnd >= 0) {
    for (let i = fnStart; i <= fnEnd; i++) {
      console.log('  ' + String(i+1).padStart(4, ' ') + ': ' + lines[i]);
    }
  } else {
    console.log('  could not find function close brace; dumping next 80 lines:');
    for (let i = fnStart; i < Math.min(lines.length, fnStart + 80); i++) {
      console.log('  ' + String(i+1).padStart(4, ' ') + ': ' + lines[i]);
    }
  }
}

// Dump the Play button onPress (first occurrence)
console.log('\n--- Play button onPress (the one users actually tap) ---');
const playBtnIdx = lines.findIndex(l => /styles\.playButton[^F]/.test(l) || /styles\.playButton$/.test(l));
if (playBtnIdx > 0) {
  // Print 12 lines BEFORE it (where the onPress arrow function lives)
  const start = Math.max(0, playBtnIdx - 12);
  const end = Math.min(lines.length, playBtnIdx + 8);
  for (let i = start; i < end; i++) {
    console.log('  ' + String(i+1).padStart(4, ' ') + ': ' + lines[i]);
  }
} else {
  console.log('  could not locate Play button line');
}

// Dump the autoplay handler
console.log('\n--- Auto-play (Play Next) selection ---');
const autoIdx = lines.findIndex(l => l.includes('[AUTOPLAY] Content ready'));
if (autoIdx > 0) {
  const start = Math.max(0, autoIdx - 8);
  const end = Math.min(lines.length, autoIdx + 6);
  for (let i = start; i < end; i++) {
    console.log('  ' + String(i+1).padStart(4, ' ') + ': ' + lines[i]);
  }
} else {
  console.log('  no [AUTOPLAY] log line found');
}

console.log('\n========================================');
console.log('  Send this entire output back so I can see what is actually there.');
console.log('========================================');
