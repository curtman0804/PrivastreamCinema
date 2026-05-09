/* eslint-disable */
// apply_patches_v12.js  — COMMENTARY FILTER
// Run from project root:   node apply_patches_v12.js
//
// Fixes auto-pick landing on a commentary track. Adds isCommentary detection
// to parseStreamInfo and a -2000 penalty in computeScore so commentary
// streams are guaranteed to sink to the bottom of every sort.
//
// Detects: "commentary", "comm.", "[comm]", "creator comm", "with commentary",
//          "audio commentary", "director commentary", "writers commentary".
//
// Surgical edit, zero JSX changes — purely string detection + score penalty.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }
let src = fs.readFileSync(DETAILS, 'utf8');
const orig = src;
const bak = DETAILS + '.bak.v12.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// 1. Add commentary detection inside parseStreamInfo, after HEVC/HDR detection
{
  const MARKER = 'PATCH_V12_COMMENTARY_DETECT';
  if (src.includes(MARKER)) {
    ok('commentary detection already present');
  } else {
    // Anchor: the line with isHDR detection added by V9
    const anchor = "  const isHDR = combined.includes('HDR') || combined.includes('DOLBY VISION') || combined.includes('DOLBYVISION') || combined.includes('DV.') || combined.includes(' DV ') || combined.includes('10BIT') || combined.includes('10-BIT') || combined.includes('10 BIT');";
    if (!src.includes(anchor)) {
      bad('could not find isHDR anchor (V9) for commentary insertion');
    } else {
      const insertion = anchor + '\n\n' + [
        '  // ' + MARKER + ' — exclude commentary tracks (creator/director/audio commentary).',
        '  // Heavy penalty in computeScore guarantees these sink to the bottom of the list.',
        '  const isCommentary = (',
        '    combined.includes(\'COMMENTARY\') ||',
        '    combined.includes(\'COMM TRACK\') ||',
        '    combined.includes(\'COMM-TRACK\') ||',
        '    combined.includes(\'CREATOR COMM\') ||',
        '    combined.includes(\'DIRECTOR COMM\') ||',
        '    combined.includes(\'WRITER COMM\') ||',
        '    combined.includes(\'WRITERS COMM\') ||',
        '    combined.includes(\'WITH COMM\') ||',
        '    combined.includes(\'AUDIO COMM\') ||',
        '    /\\[\\s*COMM[^\\]]*\\]/.test(combined) ||',
        '    /\\bCOMM\\.\\b/.test(combined)',
        '  );',
      ].join('\n');
      src = src.replace(anchor, insertion);
      ok('added commentary detection in parseStreamInfo');
    }
  }
}

// 2. Add isCommentary to parseStreamInfo's return object
{
  // V11-A wrapped the return in `_result`. Match that.
  const oldReturn = "  const _result = { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR };";
  const newReturn = "  const _result = { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR, isCommentary };";
  if (src.includes(newReturn)) {
    ok('isCommentary already in return');
  } else if (src.includes(oldReturn)) {
    src = src.replace(oldReturn, newReturn);
    ok('parseStreamInfo return now exposes isCommentary');
  } else {
    // Fallback: V11-A may not be applied. Try the original V9 return.
    const oldReturnV9 = "  return { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR };";
    const newReturnV9 = "  return { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR, isCommentary };";
    if (src.includes(oldReturnV9)) {
      src = src.replace(oldReturnV9, newReturnV9);
      ok('parseStreamInfo return now exposes isCommentary (V9 path)');
    } else {
      bad('could not find parseStreamInfo return to extend');
    }
  }
}

// 3. Heavy penalty in computeScore for commentary streams
{
  const MARKER = 'PATCH_V12_COMMENTARY_PENALTY';
  if (src.includes(MARKER)) {
    ok('commentary penalty already in computeScore');
  } else {
    // Anchor: the first line of computeScore body (after the function declaration)
    const anchor = "    let s = 0;\n    if (info.language === 'ENG') s += 1000;";
    if (!src.includes(anchor)) {
      bad('could not find computeScore body anchor');
    } else {
      const replacement = [
        "    let s = 0;",
        "    // " + MARKER + " — guarantee commentary tracks rank LAST",
        "    if (info.isCommentary) s -= 2000;",
        "    if (info.language === 'ENG') s += 1000;",
      ].join('\n');
      src = src.replace(anchor, replacement);
      ok('commentary now gets -2000 penalty in computeScore');
    }
  }
}

// Save
if (src !== orig) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes — already patched');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV12 done. Rebuild — auto-pick will now skip commentary tracks.');
  console.log('After confirming, tell me whether commentary should be HIDDEN from the');
  console.log('visible stream list entirely (V12-B) or just deprioritized (current V12).');
}
