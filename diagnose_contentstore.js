/* eslint-disable */
// diagnose_contentstore.js — Read-only dump for the V46 watchdog fix.
//
// Prints the contentStore.ts file with line numbers + finds key anchors
// so the next patch (V46) can correctly inject a watchdog timeout in
// fetchStreams() to clear isLoadingStreams if it hangs.
//
// Usage (Windows CMD, from frontend dir or repo root):
//   node diagnose_contentstore.js
//
// It writes ./contentstore_dump.txt next to wherever you run it from.

const fs = require('fs');
const path = require('path');

const candidates = [
  path.join('frontend', 'src', 'store', 'contentStore.ts'),
  path.join('src', 'store', 'contentStore.ts'),
  path.join('store', 'contentStore.ts'),
];

let FILE = null;
for (const c of candidates) {
  if (fs.existsSync(c)) { FILE = c; break; }
}
if (!FILE) {
  console.error('ERROR: contentStore.ts not found. Tried:');
  candidates.forEach((c) => console.error('  - ' + c));
  process.exit(1);
}

console.log('Reading: ' + FILE);
const raw = fs.readFileSync(FILE, 'utf8');
const text = raw.replace(/\r\n/g, '\n');
const lines = text.split('\n');

const numbered = lines.map((l, i) => String(i + 1).padStart(4, ' ') + ' | ' + l).join('\n');

// Find anchors of interest
const anchors = [];
const patterns = [
  { name: 'fetchStreams declaration', re: /fetchStreams\s*[:=]/ },
  { name: 'isLoadingStreams set true',  re: /isLoadingStreams\s*:\s*true/ },
  { name: 'isLoadingStreams set false', re: /isLoadingStreams\s*:\s*false/ },
  { name: 'set(\\{ streams', re: /set\(\s*\{\s*streams/ },
  { name: 'try / catch / finally', re: /^\s*(try|catch|finally)\b/ },
  { name: 'setTimeout usage', re: /setTimeout\s*\(/ },
  { name: 'AbortController', re: /AbortController/ },
  { name: 'fetchStreams call (action body)', re: /async\s+fetchStreams|fetchStreams\s*[:=]\s*async/ },
];

lines.forEach((line, idx) => {
  for (const p of patterns) {
    if (p.re.test(line)) {
      anchors.push({ ln: idx + 1, name: p.name, text: line.trim() });
    }
  }
});

const out = [];
out.push('=== FILE: ' + FILE);
out.push('=== TOTAL LINES: ' + lines.length);
out.push('=== HAS CRLF: ' + (raw.indexOf('\r\n') >= 0));
out.push('');
out.push('=== ANCHORS FOUND ===');
if (anchors.length === 0) {
  out.push('(none — file may not be the right contentStore)');
} else {
  for (const a of anchors) {
    out.push('  L' + a.ln + '  [' + a.name + ']  ' + a.text);
  }
}
out.push('');
out.push('=== FULL FILE WITH LINE NUMBERS ===');
out.push(numbered);

const dumpPath = 'contentstore_dump.txt';
fs.writeFileSync(dumpPath, out.join('\n'), 'utf8');

console.log('');
console.log('Dump written to: ' + dumpPath);
console.log('Anchors found: ' + anchors.length);
console.log('');
console.log('Please share contentstore_dump.txt back so V46 can be authored precisely.');
