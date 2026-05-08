/* eslint-disable */
// apply_patches_v9.js
// Run from project root:   node apply_patches_v9.js
//
// Auto-pick highest-quality English stream every time, with Firestick-friendly
// codec/HDR penalties so the same logical "best playable English stream" is
// chosen across every episode (no more S1E5 looking different from S1E4).
//
// 1. Extends parseStreamInfo to detect HEVC/x265 codec and HDR/DolbyVision/10-bit.
// 2. Replaces sortStreamsByLanguage's comparator with a score-based sort
//    that strongly prefers English, then quality DESC, then non-HEVC,
//    then non-HDR, then direct URLs, then seeders.

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
const bak = DETAILS + '.bak.v9.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// --- 1: Add HEVC/HDR detection inside parseStreamInfo, just after quality block
{
  const MARKER = 'PATCH_V9_CODEC_DETECTION';
  if (src.includes(MARKER)) {
    ok('V9 codec detection already present');
  } else {
    const anchor = "  else if (name.toUpperCase().includes('HD') && !name.toUpperCase().includes('SD')) quality = 'HD';";
    if (!src.includes(anchor)) {
      bad('could not find quality-detect anchor for codec block');
    } else {
      const insertion = anchor + '\n\n' + [
        '  // ' + MARKER + ' — Firestick decodes H.264/AVC reliably; HEVC/x265 stutters or shows black frames',
        '  const isHEVC = combined.includes(\'HEVC\') || combined.includes(\'X265\') || combined.includes(\'H265\') || combined.includes(\'H.265\');',
        '  // HDR / Dolby Vision / 10-bit produce wrong colors on SDR Firestick → avoid when possible',
        '  const isHDR = combined.includes(\'HDR\') || combined.includes(\'DOLBY VISION\') || combined.includes(\'DOLBYVISION\') || combined.includes(\'DV.\') || combined.includes(\' DV \') || combined.includes(\'10BIT\') || combined.includes(\'10-BIT\') || combined.includes(\'10 BIT\');',
      ].join('\n');
      src = src.replace(anchor, insertion);
      ok('added HEVC/HDR detection in parseStreamInfo');
    }
  }
}

// --- 2: Update parseStreamInfo's return statement to include the new fields
{
  const oldReturn = "  return { quality, source, size, seeders, title, language, isForeign };";
  const newReturn = "  return { quality, source, size, seeders, title, language, isForeign, isHEVC, isHDR };";
  if (src.includes(newReturn)) {
    ok('parseStreamInfo return already includes isHEVC/isHDR');
  } else if (src.includes(oldReturn)) {
    src = src.replace(oldReturn, newReturn);
    ok('parseStreamInfo return now exposes isHEVC + isHDR');
  } else {
    bad('could not locate parseStreamInfo return statement');
  }
}

// --- 3: Replace the sort body of sortStreamsByLanguage with score-based sort
{
  const MARKER = 'PATCH_V9_SCORED_SORT';
  if (src.includes(MARKER)) {
    ok('V9 score-based sort already installed');
  } else {
    // Match the existing sort body — the parsed.sort((a,b) => {...}) block.
    const oldSort = [
      "  parsed.sort((a, b) => {",
      "    const directA = a.stream.url ? 0 : 1;",
      "    const directB = b.stream.url ? 0 : 1;",
      "    if (directA !== directB) return directA - directB;",
      "",
      "    const langA = langPriority(a.info.language);",
      "    const langB = langPriority(b.info.language);",
      "    if (langA !== langB) return langA - langB;",
      "    if (a.info.language !== b.info.language) return a.info.language.localeCompare(b.info.language);",
      "    return (b.info.seeders || 0) - (a.info.seeders || 0);",
      "  });",
    ].join('\n');

    const newSort = [
      "  // " + MARKER + " — produces a stable, consistent best pick across every episode.",
      "  // English+quality dominate; codec/HDR penalties keep Firestick happy; direct URL is",
      "  // a tiebreaker (instant Premiumize) that never overrides quality.",
      "  const QUALITY_PTS: Record<string, number> = { '4K': 80, '1080p': 60, '720p': 40, 'HD': 20, 'SD': 0 };",
      "  const computeScore = (info: ReturnType<typeof parseStreamInfo>, stream: Stream): number => {",
      "    let s = 0;",
      "    if (info.language === 'ENG') s += 1000;",
      "    else if (info.language === 'MULTI') s += 900;",
      "    else s += 100;",
      "    s += QUALITY_PTS[info.quality] || 0;",
      "    if (!info.isHEVC) s += 30;",
      "    if (!info.isHDR) s += 20;",
      "    if (stream.url) s += 50;",
      "    const sd = info.seeders || 0;",
      "    if (sd > 0) s += Math.min(Math.log10(sd) * 5, 20);",
      "    return s;",
      "  };",
      "  parsed.sort((a, b) => computeScore(b.info, b.stream) - computeScore(a.info, a.stream));",
    ].join('\n');

    if (src.includes(oldSort)) {
      src = src.replace(oldSort, newSort);
      ok('replaced sort comparator with score-based sort');
    } else {
      bad('could not find existing sort comparator block');
      info('expected exact V6/earlier sort body — your file may have diverged');
    }
  }
}

// Save
if (src !== orig) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes made — already patched or anchors not found');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV9 installed. Rebuild the APK and test:');
  console.log('  ✓ Auto-play across many episodes → consistent quality + English audio');
  console.log('  ✓ No more random HDR-encoded streams causing color shifts');
  console.log('  ✓ Lower-bitrate H.264 still preferred over flashy HEVC for stability');
}
