/* eslint-disable */
// diagnose_details.js — Dump details/[type]/[id].tsx + how poster taps navigate to it.
const fs = require('fs');
const path = require('path');

function dump(p) {
  if (!fs.existsSync(p)) { console.log('[MISS] ' + p); return; }
  const src = fs.readFileSync(p, 'utf8');
  const lines = src.split(/\r?\n/);
  console.log('\n=== ' + p + ' (' + lines.length + ' lines, ' + src.length + ' bytes) ===');
  lines.forEach((ln, i) => console.log(String(i + 1).padStart(4, ' ') + ' | ' + ln));
}

function scan(label, files, re) {
  console.log('\n--- ' + label + ' ---');
  files.forEach(p => {
    if (!fs.existsSync(p)) return;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => { if (re.test(ln)) console.log('  ' + p + ':' + (i + 1) + ': ' + ln.trim()); });
  });
}

// Main detail screen
dump(path.join('frontend', 'app', 'details', '[type]', '[id].tsx'));

// Find where router.push to details happens — likely ContentCard or somewhere
console.log('\n=== Search for navigation to details ===');
const searchFiles = [
  path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  path.join('frontend', 'src', 'components', 'ServiceRow.tsx'),
  path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
  path.join('frontend', 'app', '(tabs)', 'search.tsx'),
];
scan('router.push or router.navigate to /details', searchFiles, /router\.(push|navigate|replace).*details/);
scan('href to details', searchFiles, /href=.*details/);
scan('onItemPress / onPress with item', searchFiles, /onItemPress|onPress.*item/);

// Print what the details screen imports
const detailsPath = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
if (fs.existsSync(detailsPath)) {
  const src = fs.readFileSync(detailsPath, 'utf8');
  console.log('\n=== Details screen quick scan ===');
  const re = /useLocalSearchParams|useGlobalSearchParams|router\.|useState|useEffect|fetchMeta|fetchStreams|isLoading|<Image|<Text/;
  src.split(/\r?\n/).forEach((ln, i) => { if (re.test(ln)) console.log('  ' + (i + 1) + ': ' + ln.trim()); });
}
