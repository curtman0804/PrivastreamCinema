/**
 * Privastream Frontend Corrective Patch v2 (Node.js)
 * ===================================================
 * Fixes the 3 issues left by apply_patches.js:
 *   - All `backdrop: content?.background ...` variants get the type-aware fallback
 *   - `nextEpisodeBackdrop` injected into the user's actual nextEpisodeData shape
 *   - The multi-line back button callback gets replaced with handleBack
 *
 * Usage on Windows CMD:
 *   cd C:\Users\Curtm\PrivastreamCinema
 *   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v2.js -o apply_patches_v2.js
 *   node apply_patches_v2.js
 *
 * Idempotent — safe to run multiple times.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = process.cwd();
const FRONTEND = path.join(REPO_ROOT, 'frontend');
const DETAILS = path.join(FRONTEND, 'app', 'details', '[type]', '[id].tsx');

if (!fs.existsSync(DETAILS)) {
  console.error('ERROR: cannot find', DETAILS);
  process.exit(1);
}

console.log('[v2] Reading details file...');
fs.copyFileSync(DETAILS, DETAILS + '.bak2');
let content = fs.readFileSync(DETAILS, 'utf-8');

// =============================================================
// FIX 1: Replace ALL `backdrop: content?.background ...` lines
// =============================================================
// We catch every variation on a SINGLE line — including
// `backdrop: content?.background || '',`
// `backdrop: content?.background || nextBackdropParam || '',`
// `backdrop: content?.background || something || '',`
//
// We inject the type-aware fallback at the front so the episode's
// own thumbnail wins for series content.
//
// Skip lines that already have currentEpisode?.thumbnail.
const backdropRegex = /^(\s*)backdrop:\s*content\?\.background\s*\|\|\s*([^\n]+),\s*$/gm;
let backdropFixCount = 0;
content = content.replace(backdropRegex, (match, indent, rest) => {
  if (match.includes("currentEpisode?.thumbnail")) return match;
  backdropFixCount += 1;
  return `${indent}backdrop: (type === 'series' && currentEpisode?.thumbnail) || content?.background || ${rest},`;
});
console.log(`[v2] FIX 1: backdrop lines updated = ${backdropFixCount}`);

// =============================================================
// FIX 2: Inject nextEpisodeBackdrop into nextEpisodeData
// =============================================================
// Find `const nextEpisodeData = nextEpisode ? {` (at any indent)
// then walk forward to its closing `} : {};` and insert
// `nextEpisodeBackdrop: ...,` right before that close.
if (!content.includes('nextEpisodeBackdrop')) {
  const startTok = 'const nextEpisodeData = nextEpisode ? {';
  const startIdx = content.indexOf(startTok);
  if (startIdx >= 0) {
    const closeTok = '} : {};';
    const closeIdx = content.indexOf(closeTok, startIdx);
    if (closeIdx >= 0) {
      // Get indentation of close line
      const lineStart = content.lastIndexOf('\n', closeIdx) + 1;
      const indent = content.substring(lineStart, closeIdx);
      const insert = `${indent}  nextEpisodeBackdrop: nextEpisode.thumbnail || content?.background || '',\n`;
      content = content.slice(0, closeIdx) + insert + content.slice(closeIdx);
      console.log('[v2] FIX 2: nextEpisodeBackdrop injected into nextEpisodeData');
    } else {
      console.log('[v2] FIX 2: could not find close of nextEpisodeData');
    }
  } else {
    console.log('[v2] FIX 2: could not find nextEpisodeData declaration');
  }
} else {
  console.log('[v2] FIX 2: nextEpisodeBackdrop already present');
}

// =============================================================
// FIX 3: Replace multi-line back button callback with handleBack
// =============================================================
// User's file at line 1043-ish has:
//
//   onPress={() => {
//     ...
//     router.back();
//     ...
//   }}
//
// We find this pattern (where the body has `router.back()` and is
// inside a back-arrow context) and replace the whole onPress prop
// with `onPress={handleBack}`.
//
// To pick the right one we look for an `onPress={() => {` whose
// body is short (< 200 chars) and contains `router.back()` AND is
// preceded within 200 chars by `arrow-back` (the back-arrow icon).
let fix3Done = content.includes('onPress={handleBack}');
if (!fix3Done) {
  // Use a regex that finds onPress with multi-line callback containing router.back()
  // and capture the preceding context to verify it's a back-button.
  const re = /onPress=\{\(\)\s*=>\s*\{([\s\S]{0,200}?)\}\}/g;
  let match;
  let replaced = false;
  while ((match = re.exec(content)) !== null) {
    const body = match[1];
    if (!/router\.back\s*\(\s*\)/.test(body)) continue;
    // Look back up to 300 chars for the arrow-back icon
    const before = content.slice(Math.max(0, match.index - 300), match.index);
    if (!/arrow-back/i.test(before)) continue;
    // Replace this match
    const start = match.index;
    const end = start + match[0].length;
    content = content.slice(0, start) + 'onPress={handleBack}' + content.slice(end);
    console.log('[v2] FIX 3: back-button onPress replaced with handleBack');
    replaced = true;
    break;
  }
  if (!replaced) {
    console.log('[v2] FIX 3: no matching back-button callback found near arrow-back icon');
    console.log('         — falling back to ANY onPress with router.back() body');
    // Fallback: replace ANY onPress={() => { ... router.back() ... }} (last resort)
    const re2 = /onPress=\{\(\)\s*=>\s*\{([\s\S]{0,300}?router\.back\s*\(\s*\)[\s\S]{0,300}?)\}\}/;
    const m2 = content.match(re2);
    if (m2) {
      content = content.replace(re2, 'onPress={handleBack}');
      console.log('[v2] FIX 3 (fallback): replaced first router.back() callback');
    } else {
      console.log('[v2] FIX 3: NO suitable back button found — manual edit needed');
    }
  }
} else {
  console.log('[v2] FIX 3: handleBack already wired up');
}

fs.writeFileSync(DETAILS, content);
console.log('[v2] Saved.\n');

// =============================================================
// Verification
// =============================================================
console.log('[v2] Verification:');
const checks = [
  ['nextEpisodeBackdrop',          'nextEpisodeBackdrop',           1],
  ['episode-thumbnail backdrop',   "currentEpisode?.thumbnail",     4],
  ['handleBack used',              'onPress={handleBack}',          1],
  ['BackHandler import',           'import { BackHandler }',        1],
  ['handleBack defined',           'const handleBack',              1],
  ['BackHandler.addEventListener', 'BackHandler.addEventListener',  1],
  ['goToSeriesRootWithFocus',      'goToSeriesRootWithFocus',       3],
  ['paramSelectedSeason',          'paramSelectedSeason',           3],
  ['currentEpisodeMeta',           'currentEpisodeMeta',            5],
  ['season-init param fallback',   'fromParam',                     1],
];
let allOk = true;
for (const [name, needle, need] of checks) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const n = (content.match(new RegExp(escaped, 'g')) || []).length;
  const ok = n >= need;
  if (!ok) allOk = false;
  const marker = ok ? '[OK]  ' : '[FAIL]';
  console.log(`    ${marker} ${name.padEnd(35)} count=${n} need>=${need}`);
}

console.log();
if (allOk) {
  console.log('==> All patches applied. Now rebuild your APK and test on Firestick.');
} else {
  console.log('==> If anything is still FAIL, paste the full output and the line where the original code lives.');
}
