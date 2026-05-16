/* eslint-disable */
// diagnose_search.js — Dump the search-related files so we know exactly what's
// shipping on the Streamer 4K and why typing doesn't work.
//
// Run from repo root:
//   node diagnose_search.js
// Writes search_dump.txt.

const fs = require('fs');
const path = require('path');

const TARGETS = [
  path.join('frontend', 'app', '(tabs)', 'search.tsx'),
  path.join('frontend', 'app', 'search.tsx'),
  path.join('frontend', 'src', 'components', 'SearchBar.tsx'),
  path.join('frontend', 'plugins', 'withTVKeyEvents'),
  path.join('frontend', 'plugins', 'withTVKeyEvents.js'),
  path.join('frontend', 'plugins', 'withTVLauncher'),
  path.join('frontend', 'plugins', 'withTVLauncher.js'),
];

const out = [];
function w(s) { out.push(s); }

for (const p of TARGETS) {
  if (!fs.existsSync(p)) {
    w('=== ' + p + '  (NOT FOUND)');
    continue;
  }
  const stat = fs.statSync(p);
  if (stat.isDirectory()) {
    w('=== DIR: ' + p);
    const entries = fs.readdirSync(p);
    for (const e of entries) {
      const sub = path.join(p, e);
      const subStat = fs.statSync(sub);
      if (subStat.isFile()) {
        const txt = fs.readFileSync(sub, 'utf8').replace(/\r\n/g, '\n');
        w('  --- FILE: ' + sub + '  (' + subStat.size + ' bytes)');
        const lines = txt.split('\n');
        lines.forEach((l, i) => w('  ' + String(i + 1).padStart(4, ' ') + ' | ' + l));
      } else {
        w('  --- SUBDIR: ' + sub);
      }
    }
    w('');
    continue;
  }
  const text = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  w('================================================================');
  w('=== FILE: ' + p + '   (' + lines.length + ' lines)');
  w('================================================================');
  lines.forEach((l, i) => w(String(i + 1).padStart(4, ' ') + ' | ' + l));
  w('');
}

// Surface key search-related signals
w('================================================================');
w('=== KEY SIGNALS ===');
w('================================================================');
for (const p of TARGETS) {
  if (!fs.existsSync(p)) continue;
  if (fs.statSync(p).isDirectory()) continue;
  const t = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  const lines = t.split('\n');
  const sigs = [];
  const patterns = [
    { name: 'TextInput',          re: /<TextInput\b/ },
    { name: 'autoFocus',          re: /\bautoFocus\b/ },
    { name: 'showSoftInputOnFocus',re: /showSoftInputOnFocus/ },
    { name: 'Platform.isTV',      re: /Platform\.isTV/ },
    { name: 'Platform.OS',        re: /Platform\.OS/ },
    { name: 'expo-key-event',     re: /expo-key-event/ },
    { name: 'useKeyEvent',        re: /useKeyEvent/ },
    { name: 'KeyEvent listener',  re: /KeyEvent/ },
    { name: 'voice search',       re: /voice/i },
    { name: 'TV focus handle',    re: /hasTVPreferredFocus/ },
    { name: 'Keyboard.dismiss',   re: /Keyboard\.dismiss/ },
  ];
  lines.forEach((l, i) => {
    for (const pat of patterns) {
      if (pat.re.test(l)) sigs.push({ ln: i + 1, name: pat.name, text: l.trim() });
    }
  });
  w('');
  w('--- ' + p + ' (' + sigs.length + ' signals) ---');
  for (const s of sigs) w('  L' + s.ln + '  [' + s.name + ']  ' + s.text);
}

fs.writeFileSync('search_dump.txt', out.join('\n'), 'utf8');
console.log('Dump written: search_dump.txt');
console.log('Share it back so we can fix Streamer 4K search.');
