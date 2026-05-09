/* eslint-disable */
// apply_patches_v14b.js  — line-based fixes for V14's two failed patches
// Uses array-of-lines manipulation instead of literal text match so CRLF/LF
// differences don't matter.

const fs = require('fs');
const path = require('path');

const TABS_LAYOUT = path.join('frontend', 'app', '(tabs)', '_layout.tsx');
const DISCOVER    = path.join('frontend', 'app', '(tabs)', 'discover.tsx');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

function readLines(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  return { lines: raw.split(/\r?\n/), eol };
}
function writeLines(p, lines, eol) {
  fs.writeFileSync(p, lines.join(eol), 'utf8');
}
function backup(p) {
  const bak = p + '.bak.v14b.' + Date.now();
  fs.copyFileSync(p, bak);
  info('backup → ' + bak);
}

// ====================================================================
// 1. Tabs layout — add freezeOnBlur+lazy after `screenOptions={{`
// ====================================================================
console.log('\n=== Patching ' + TABS_LAYOUT + ' ===');
{
  const MARKER = 'PATCH_V14B_FREEZE_ON_BLUR_TABS';
  const { lines, eol } = readLines(TABS_LAYOUT);
  const orig = lines.join(eol);

  if (orig.includes(MARKER) || /freezeOnBlur:\s*true/.test(orig)) {
    ok('Tabs already has freezeOnBlur (or marker present)');
  } else {
    backup(TABS_LAYOUT);
    // Find the line with `screenOptions={{` (could have any leading whitespace)
    const screenOptIdx = lines.findIndex(l => /screenOptions=\{\{\s*$/.test(l));
    if (screenOptIdx < 0) {
      bad('could not find `screenOptions={{` line in tabs layout');
    } else {
      // Determine indentation of the next line so our injection matches
      const nextLine = lines[screenOptIdx + 1] || '';
      const indentMatch = nextLine.match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '        ';

      const inject = [
        indent + '// ' + MARKER,
        indent + 'freezeOnBlur: true,',
        indent + 'lazy: true,',
      ];
      lines.splice(screenOptIdx + 1, 0, ...inject);
      writeLines(TABS_LAYOUT, lines, eol);
      ok('added freezeOnBlur+lazy to Tabs screenOptions (line ' + (screenOptIdx + 2) + ')');
    }
  }
}

// ====================================================================
// 2. Discover — tighten Continue Watching FlatList virtualization
// ====================================================================
console.log('\n=== Patching ' + DISCOVER + ' ===');
{
  const MARKER = 'PATCH_V14B_CW_VIRT';
  const { lines, eol } = readLines(DISCOVER);
  const orig = lines.join(eol);

  if (orig.includes(MARKER)) {
    ok('Continue Watching virtualization already tightened');
  } else {
    backup(DISCOVER);

    // Find the line `data={continueWatching}`
    const dataIdx = lines.findIndex(l => /data=\{continueWatching\}/.test(l));
    if (dataIdx < 0) {
      bad('could not find data={continueWatching} line');
    } else {
      // Within the next ~12 lines, locate the three offending props.
      let removeClippedIdx = -1, windowSizeIdx = -1, initialIdx = -1, closeIdx = -1;
      for (let i = dataIdx + 1; i < Math.min(lines.length, dataIdx + 20); i++) {
        const l = lines[i];
        if (/removeClippedSubviews=\{false\}/.test(l)) removeClippedIdx = i;
        if (/windowSize=\{21\}/.test(l))               windowSizeIdx = i;
        if (/initialNumToRender=\{10\}/.test(l))       initialIdx = i;
        if (/^\s*\/>\s*$/.test(l)) { closeIdx = i; break; }
      }

      // Fix the existing values in-place so we don't disrupt other props
      if (removeClippedIdx >= 0) {
        lines[removeClippedIdx] = lines[removeClippedIdx].replace('removeClippedSubviews={false}', 'removeClippedSubviews={true}');
      }
      if (windowSizeIdx >= 0) {
        lines[windowSizeIdx] = lines[windowSizeIdx].replace('windowSize={21}', 'windowSize={5}');
      }
      if (initialIdx >= 0) {
        lines[initialIdx] = lines[initialIdx].replace('initialNumToRender={10}', 'initialNumToRender={3}');
      }

      // Insert two extra props (maxToRenderPerBatch + updateCellsBatchingPeriod)
      // right before the `/>` closing line, with matching indentation.
      if (closeIdx >= 0) {
        const indent = (lines[closeIdx - 1].match(/^(\s*)/) || ['', ''])[1] || '                ';
        const inject = [
          indent + '// ' + MARKER,
          indent + 'maxToRenderPerBatch={3}',
          indent + 'updateCellsBatchingPeriod={50}',
        ];
        lines.splice(closeIdx, 0, ...inject);
      }

      const tightened = (removeClippedIdx >= 0 ? 1 : 0) + (windowSizeIdx >= 0 ? 1 : 0) + (initialIdx >= 0 ? 1 : 0);
      if (tightened > 0 || closeIdx >= 0) {
        writeLines(DISCOVER, lines, eol);
        ok('Continue Watching virtualization tightened (' + tightened + ' values updated, 2 props added)');
      } else {
        bad('found data={continueWatching} but none of the props matched');
      }
    }
  }
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');
if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV14b done. Rebuild and test on the Google Streamer 4K.');
}
