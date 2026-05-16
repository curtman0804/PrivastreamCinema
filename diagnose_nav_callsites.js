/* eslint-disable */
// diagnose_nav_callsites.js — Find all router navigations to /details/* and ContentCard usage.
//
// Run from repo root (where frontend/ lives):
//   node diagnose_nav_callsites.js
//
// Writes nav_callsites_dump.txt with context around each match so we can
// see EXACTLY what router pattern the codebase uses (router.push('...'),
// router.push({ pathname: ... }), router.navigate, Link href=, etc.).

const fs = require('fs');
const path = require('path');

const FILES = [
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('frontend', 'app', '(tabs)', 'library.tsx'),
  path.join('frontend', 'app', '(tabs)', 'search.tsx'),
  path.join('frontend', 'app', 'search.tsx'),
  path.join('frontend', 'app', 'category', '[service]', '[type].tsx'),
  path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  path.join('frontend', 'app', 'details', '[type]', '[id].tsx'),
];

const out = [];
function pushLine(s) { out.push(s); }

function dumpFile(F) {
  pushLine('');
  pushLine('================================================================');
  pushLine('=== FILE: ' + F);
  pushLine('================================================================');
  if (!fs.existsSync(F)) {
    pushLine('  (file not found)');
    return;
  }
  const raw = fs.readFileSync(F, 'utf8');
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  pushLine('=== TOTAL LINES: ' + lines.length + '   CRLF: ' + (raw.indexOf('\r\n') >= 0));

  // Anchors of interest
  const anchors = [];
  const patterns = [
    { tag: 'details path',     re: /\/details\// },
    { tag: 'router.push',      re: /router\s*\.\s*push/ },
    { tag: 'router.navigate',  re: /router\s*\.\s*navigate/ },
    { tag: 'router.replace',   re: /router\s*\.\s*replace/ },
    { tag: 'pathname:',        re: /pathname\s*:/ },
    { tag: 'href=',            re: /\bhref\s*=/ },
    { tag: 'navigation.push',  re: /navigation\s*\.\s*push/ },
    { tag: 'navigation.navig', re: /navigation\s*\.\s*navigate/ },
    { tag: 'useLocalSearchPar',re: /useLocalSearchParams|useSearchParams/ },
    { tag: 'ContentCard usage',re: /<ContentCard\b/ },
    { tag: 'onPress=',         re: /onPress\s*=/ },
    { tag: 'name: item',       re: /name\s*:\s*item/ },
    { tag: 'poster: item',     re: /poster\s*:\s*item/ },
  ];

  lines.forEach((line, idx) => {
    for (const p of patterns) {
      if (p.re.test(line)) {
        anchors.push({ ln: idx + 1, tag: p.tag, text: line });
      }
    }
  });

  pushLine('');
  pushLine('--- ANCHORS (' + anchors.length + ') ---');
  for (const a of anchors) {
    pushLine('  L' + String(a.ln).padStart(4, ' ') + '  [' + a.tag + ']  ' + a.text.trim());
  }

  // For every "details" or "router.push" anchor, print 10 lines of context.
  const printedRanges = new Set();
  pushLine('');
  pushLine('--- CONTEXT BLOCKS (±6 lines around router/details anchors) ---');
  for (const a of anchors) {
    if (!/details|router|navigation|href=|<ContentCard/.test(a.tag) && !/details path|router\.|navigation\./.test(a.tag)) continue;
    const start = Math.max(1, a.ln - 6);
    const end   = Math.min(lines.length, a.ln + 8);
    const key = start + '_' + end;
    if (printedRanges.has(key)) continue;
    printedRanges.add(key);
    pushLine('');
    pushLine('  >>> around L' + a.ln + ' [' + a.tag + ']:');
    for (let i = start; i <= end; i++) {
      const marker = (i === a.ln) ? ' >>>' : '    ';
      pushLine(marker + ' ' + String(i).padStart(4, ' ') + ' | ' + lines[i - 1]);
    }
  }
}

console.log('Scanning callsites...');
for (const F of FILES) dumpFile(F);

const dumpPath = 'nav_callsites_dump.txt';
fs.writeFileSync(dumpPath, out.join('\n'), 'utf8');
console.log('\nDump written: ' + dumpPath);
console.log('Please share that file back so V45b can be tailored to your real code.');
