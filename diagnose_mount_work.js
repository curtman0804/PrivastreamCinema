/* eslint-disable */
// diagnose_mount_work.js — READ-ONLY. Dump the mount-time/focus-time work
// in details and discover so V39 can defer the right things.
//
// Run from project root:  node diagnose_mount_work.js > diag_mount.txt
// Then paste diag_mount.txt back.

const fs = require('fs');
const path = require('path');

const FILES = {
  details:  path.join('frontend', 'app', 'details', '[type]', '[id].tsx'),
  discover: path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
};

function header(t) {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + t);
  console.log('='.repeat(72));
}

function showLineRange(label, src, fromLine, toLine) {
  const lines = src.split(/\r?\n/);
  const a = Math.max(0, fromLine - 1);
  const b = Math.min(lines.length - 1, toLine - 1);
  console.log('\n  -- ' + label + '  (L' + (a + 1) + '–L' + (b + 1) + ') --');
  for (let i = a; i <= b; i++) {
    console.log('  L' + (i + 1).toString().padStart(4) + ': ' + lines[i]);
  }
}

function dumpBlocksAt(label, src, startRegex, maxBlocks, maxLinesPerBlock) {
  const lines = src.split(/\r?\n/);
  const starts = [];
  for (let i = 0; i < lines.length; i++) if (startRegex.test(lines[i])) starts.push(i);
  console.log('\n  -- ' + label + ' (' + starts.length + ' block' + (starts.length === 1 ? '' : 's') + ') --');
  if (starts.length === 0) { console.log('    (none)'); return; }
  for (const s of starts.slice(0, maxBlocks)) {
    // Find the closing `}, [...])` of this hook by depth tracking.
    let depth = 0, sawOpen = false, end = s;
    for (let i = s; i < lines.length && i < s + maxLinesPerBlock; i++) {
      for (const ch of lines[i]) {
        if (ch === '{') { depth++; sawOpen = true; }
        else if (ch === '}') { depth--; }
      }
      if (sawOpen && depth <= 0) { end = i; break; }
      end = i;
    }
    // Try to extend to the closing `);` (dep array) up to 2 more lines
    for (let k = end + 1; k <= end + 3 && k < lines.length; k++) {
      console.log('  L' + (k + 1).toString().padStart(4) + ': ' + lines[k]);
    }
    console.log('  --- block start ---');
    for (let i = s; i <= Math.min(end + 2, lines.length - 1); i++) {
      console.log('  L' + (i + 1).toString().padStart(4) + ': ' + lines[i]);
    }
    console.log('  --- block end ---');
  }
}

console.log('# diagnose_mount_work.js — read-only');
console.log('# generated: ' + new Date().toISOString());

// =====================================================================
header('details/[type]/[id].tsx — all 9 mount useEffects + 2 useFocusEffects');
const det = fs.existsSync(FILES.details) ? fs.readFileSync(FILES.details, 'utf8') : null;
if (!det) console.log('  [MISSING]');
else {
  // From the prior diagnostic, useEffects start at these lines roughly:
  // L40, L546, L637, L654, L670, L680, L692 (useFocusEffect), L722, L731, L761
  // Dump each as a 40-line slice.
  const heads = [
    [35, 80,   'animation loop (L40 area)'],
    [540, 560, 'V34 back handler'],
    [630, 660, 'meta fetch on mount'],
    [650, 670, 'season selection effect'],
    [665, 690, 'autoplay back handler'],
    [675, 700, 'library check'],
    [685, 725, 'useFocusEffect — watched episodes load'],
    [715, 740, 'autoplay trigger / streams loaded tracker'],
    [755, 790, 'stream prewarm'],
  ];
  for (const [a, b, lab] of heads) showLineRange(lab, det, a, b);
}

// =====================================================================
header('(tabs)/discover.tsx — focus effects, refresh handlers, item-focus handler');
const disc = fs.existsSync(FILES.discover) ? fs.readFileSync(FILES.discover, 'utf8') : null;
if (!disc) console.log('  [MISSING]');
else {
  const heads = [
    [60, 105,  'top of TabScreen — refreshing state + fetchContinueWatching'],
    [85, 115,  'useEffect + useCallback (continue watching focus refresh?)'],
    [115, 165, 'hasContent useMemo + handleSectionFocus + handleItemFocus'],
    [330, 380, 'FlatList block + LazyMount wrapper'],
    [410, 470, 'card subcomponent w/ focus state (re-render on every focus)'],
  ];
  for (const [a, b, lab] of heads) showLineRange(lab, disc, a, b);

  // Also: explicitly find any useFocusEffect or onRefresh in discover
  dumpBlocksAt('useFocusEffect blocks in discover', disc, /useFocusEffect/, 5, 60);
}

console.log('\n# done.');
