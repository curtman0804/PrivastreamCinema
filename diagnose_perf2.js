/* eslint-disable */
// diagnose_perf2.js — Full dump of every file that controls Android TV perf
// on the Discover screen and back-navigation. Run from repo root:
//   node diagnose_perf2.js
//
// Produces perf_dump.txt — share that file back.

const fs = require('fs');
const path = require('path');

const FILES = [
  { tag: 'TAB_LAYOUT', p: path.join('frontend', 'app', '(tabs)', '_layout.tsx'),         full: true },
  { tag: 'ROOT_LAYOUT',p: path.join('frontend', 'app', '_layout.tsx'),                   full: true },
  { tag: 'DISCOVER',   p: path.join('frontend', 'app', '(tabs)', 'discover.tsx'),        full: true },
  { tag: 'SERVICE_ROW',p: path.join('frontend', 'src', 'components', 'ServiceRow.tsx'),  full: true },
  { tag: 'CONTENT_CARD',p:path.join('frontend', 'src', 'components', 'ContentCard.tsx'), full: true },
  { tag: 'DETAILS_HEAD',p:path.join('frontend', 'app', 'details', '[type]', '[id].tsx'), full: false, lines: 250 },
];

const out = [];
function w(s) { out.push(s); }

for (const f of FILES) {
  w('');
  w('================================================================');
  w('=== [' + f.tag + ']  FILE: ' + f.p);
  w('================================================================');
  if (!fs.existsSync(f.p)) {
    w('  (NOT FOUND)');
    continue;
  }
  const raw = fs.readFileSync(f.p, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  w('=== TOTAL LINES: ' + lines.length + '   CRLF: ' + (raw.indexOf('\r\n') >= 0));
  w('');

  const limit = f.full ? lines.length : Math.min(lines.length, f.lines || 250);
  for (let i = 0; i < limit; i++) {
    w(String(i + 1).padStart(5, ' ') + ' | ' + lines[i]);
  }
  if (!f.full && lines.length > limit) {
    w('...');
    w('(truncated — ' + (lines.length - limit) + ' more lines)');
  }
}

// Also surface high-signal perf flags found anywhere in those files
w('');
w('================================================================');
w('=== PERF FLAGS DETECTED ===');
w('================================================================');
const flagPatterns = [
  { name: 'FlatList',                  re: /<FlatList\b/ },
  { name: 'ScrollView',                re: /<ScrollView\b/ },
  { name: 'FlashList',                 re: /<FlashList\b/ },
  { name: 'removeClippedSubviews',     re: /removeClippedSubviews/ },
  { name: 'windowSize',                re: /\bwindowSize\b/ },
  { name: 'initialNumToRender',        re: /initialNumToRender/ },
  { name: 'maxToRenderPerBatch',       re: /maxToRenderPerBatch/ },
  { name: 'getItemLayout',             re: /getItemLayout/ },
  { name: 'unmountOnBlur',             re: /unmountOnBlur/ },
  { name: 'freezeOnBlur',              re: /freezeOnBlur/ },
  { name: 'detachInactiveScreens',     re: /detachInactiveScreens/ },
  { name: 'InteractionManager',        re: /InteractionManager/ },
  { name: 'useFocusEffect',            re: /useFocusEffect/ },
  { name: 'requestAnimationFrame',     re: /requestAnimationFrame/ },
  { name: 'React.memo',                re: /React\.memo|^memo\(/ },
  { name: 'useMemo',                   re: /useMemo\(/ },
  { name: 'useCallback',               re: /useCallback\(/ },
  { name: 'Image (RN core)',           re: /from\s+'react-native'.*Image|\bImage,\s/ },
  { name: 'expo-image',                re: /expo-image/ },
  { name: 'react-native-fast-image',   re: /react-native-fast-image/ },
  { name: 'Animated.',                 re: /\bAnimated\./ },
  { name: 'reanimated',                re: /react-native-reanimated/ },
  { name: 'setTimeout in mount queue', re: /mountQueue|mount\s*queue/i },
  { name: 'staggered mount',           re: /staggered|stagger/i },
  { name: 'screens=true (Stack)',      re: /screens\s*:\s*true|screens=\{true\}/ },
];

for (const f of FILES) {
  if (!fs.existsSync(f.p)) continue;
  const text = fs.readFileSync(f.p, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const hits = [];
  for (const fp of flagPatterns) {
    lines.forEach((l, idx) => { if (fp.re.test(l)) hits.push({ ln: idx + 1, name: fp.name, text: l.trim() }); });
  }
  w('');
  w('--- [' + f.tag + '] (' + hits.length + ' flags) ---');
  for (const h of hits) w('  L' + String(h.ln).padStart(4, ' ') + '  [' + h.name + ']  ' + h.text);
}

fs.writeFileSync('perf_dump.txt', out.join('\n'), 'utf8');
console.log('Dump written: perf_dump.txt');
console.log('Share that file back — it has every file the perf overhaul needs.');
