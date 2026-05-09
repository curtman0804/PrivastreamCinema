/* eslint-disable */
// apply_patches_v18.js — REAL commentary fix + UI request
// Run from project root:   node apply_patches_v18.js
//
// PROBLEM: V12-V16A fixed title-based commentary detection, but R&M Blu-ray
// rips (e.g. "Rick.and.Morty.S01E01.1080p.BluRay.x264-DEMAND") have NO
// commentary marker in the title — the commentary is the DEFAULT audio
// track inside the file. expo-av cannot switch audio tracks at runtime,
// so the only fix is to deprioritize Blu-ray rips for series. WEB-DL/WEBRip
// rips come from streaming services (Netflix/HBO/Disney+) that never include
// commentary, and for animated shows like R&M the visual quality is
// essentially identical to Blu-ray.
//
// Two changes:
//   1. computeScore: penalize series Blu-ray rips by -300 (only when title
//      has S##E## or ##x## pattern). Movies unaffected.
//   2. Replace the COMM badge with a tiny gold chat-bubble icon positioned
//      at the top-right of the card (no "COMM" text). Removes the old
//      V15-A insertion.

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
const bak = DETAILS + '.bak.v18.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// =====================================================================
// PART 1: Add Blu-ray-for-series penalty in computeScore
// =====================================================================
{
  const MARKER = 'PATCH_V18_BLURAY_SERIES_PENALTY';
  if (src.includes(MARKER)) {
    ok('Blu-ray series penalty already present');
  } else {
    // V12 left this exact line in computeScore — anchor on it.
    const anchor = "    if (info.isCommentary) s -= 2000;";
    if (!src.includes(anchor)) {
      bad('could not find V12 commentary penalty anchor in computeScore');
    } else {
      const insertion = [
        "    if (info.isCommentary) s -= 2000;",
        "    // " + MARKER + " — Blu-ray rips of series often have creator commentary as the",
        "    // DEFAULT audio track (R&M, Family Guy, Rick & Morty, etc.). expo-av can't",
        "    // switch tracks, so we deprioritize series Blu-rays in favor of WEB-DL/WEBRip",
        "    // which come from streaming services that never include commentary.",
        "    {",
        "      const _t18 = ((stream.title || '') + ' ' + (stream.name || '')).toUpperCase();",
        "      const _isSeriesEp = /S\\d{1,2}E\\d{1,2}\\b/i.test(_t18) || /\\b\\d{1,2}X\\d{1,2}\\b/i.test(_t18);",
        "      const _isBluRayLike = _t18.includes('BLURAY') || _t18.includes('BLU-RAY') || _t18.includes('BDRIP') || _t18.includes('BD-RIP') || _t18.includes('REMUX');",
        "      if (_isSeriesEp && _isBluRayLike) s -= 300;",
        "    }",
      ].join('\n');
      src = src.replace(anchor, insertion);
      ok('inserted Blu-ray-for-series penalty in computeScore');
    }
  }
}

// =====================================================================
// PART 2: Remove existing COMM badge JSX (V13 and/or V15-A inserted)
// =====================================================================
// V13 inserted: {isCommentary && (...COMM text...)} BEFORE the lang badge.
// V15-A inserted the same block AFTER streamBadgeRow opener.
// Both share the same `<Text style={styles.commentaryBadgeText}>COMM</Text>` line.
// Strategy: search for that distinctive line and remove the surrounding
// `{isCommentary && (` ... `)}` block, regardless of indent.
{
  const MARKER = 'PATCH_V18_BADGE_REMOVED';
  if (src.includes(MARKER)) {
    ok('old badge already removed');
  } else {
    const lines = src.split(/\r?\n/);
    const eol = src.includes('\r\n') ? '\r\n' : '\n';
    let removed = 0;
    let safety = 0;

    while (safety++ < 5) {
      // Find a line containing the COMM text element
      const textIdx = lines.findIndex(l => l.includes('styles.commentaryBadgeText') && l.includes('COMM'));
      if (textIdx < 0) break;

      // Walk backwards to find `{isCommentary && (` opener
      let openIdx = -1;
      for (let i = textIdx; i >= Math.max(0, textIdx - 8); i--) {
        if (/\{isCommentary\s*&&\s*\($/.test(lines[i].trim()) || /\{isCommentary\s*&&\s*\(/.test(lines[i])) {
          openIdx = i; break;
        }
      }
      // Walk backwards further to find a leading `{/* PATCH_V13_... */}` or `{/* PATCH_V15A_... */}` comment if present
      let commentIdx = -1;
      if (openIdx > 0 && /\{\/\*\s*PATCH_V1(3|5A)_COMM/.test(lines[openIdx - 1])) {
        commentIdx = openIdx - 1;
      }
      // Walk forward to find the matching `)}` closer
      let closeIdx = -1;
      for (let i = textIdx + 1; i < Math.min(lines.length, textIdx + 8); i++) {
        if (/\)\}/.test(lines[i].trim())) { closeIdx = i; break; }
      }

      if (openIdx < 0 || closeIdx < 0) {
        bad('could not bracket the existing COMM badge block (textIdx=' + (textIdx+1) + ')');
        break;
      }
      const startRemove = commentIdx >= 0 ? commentIdx : openIdx;
      const count = closeIdx - startRemove + 1;
      lines.splice(startRemove, count);
      removed++;
      info('  removed badge block at lines ' + (startRemove+1) + '..' + (closeIdx+1) + ' (' + count + ' lines)');
    }

    if (removed > 0) {
      src = lines.join(eol);
      ok('removed ' + removed + ' old COMM badge block(s)');
    } else {
      info('no existing COMM badge JSX found — nothing to remove');
    }
  }
}

// =====================================================================
// PART 3: Add a new top-right gold chat-bubble icon to StreamCard
// =====================================================================
{
  const MARKER = 'PATCH_V18_TOPRIGHT_BUBBLE';
  if (src.includes(MARKER)) {
    ok('top-right gold bubble already present');
  } else {
    // Anchor: the Pressable opener of StreamCard, immediately followed by Row 1 comment.
    // The exact text used in the original file:
    //   onBlur={() => setIsFocused(false)}
    //   >
    //     {/* Row 1: Source */}
    const anchor = "      onBlur={() => setIsFocused(false)}\n    >\n      {/* Row 1: Source */}";
    if (!src.includes(anchor)) {
      bad('could not find StreamCard Pressable opener anchor');
    } else {
      const replacement = [
        "      onBlur={() => setIsFocused(false)}",
        "    >",
        "      {/* " + MARKER + " — gold chat-bubble at top-right when stream is commentary */}",
        "      {isCommentary && (",
        "        <View style={styles.commentaryBadgeTopRight} pointerEvents=\"none\">",
        "          <Ionicons name=\"chatbubble\" size={12} color=\"#B8A05C\" />",
        "        </View>",
        "      )}",
        "      {/* Row 1: Source */}",
      ].join('\n');
      src = src.replace(anchor, replacement);
      ok('inserted top-right gold chat-bubble JSX in StreamCard');
    }
  }
}

// =====================================================================
// PART 4: Add the new commentaryBadgeTopRight style
// =====================================================================
{
  const MARKER = 'PATCH_V18_TOPRIGHT_BUBBLE_STYLE';
  if (src.includes(MARKER)) {
    ok('commentaryBadgeTopRight style already present');
  } else {
    // Append before the very last `});` in the file (StyleSheet.create close).
    const lastIdx = src.lastIndexOf('});');
    if (lastIdx < 0) {
      bad('could not find StyleSheet.create close brace');
    } else {
      const styleBlock = [
        "  // " + MARKER,
        "  commentaryBadgeTopRight: {",
        "    position: 'absolute',",
        "    top: 6,",
        "    right: 6,",
        "    zIndex: 10,",
        "    backgroundColor: 'rgba(0,0,0,0.65)',",
        "    borderWidth: 1,",
        "    borderColor: '#B8A05C',",
        "    borderRadius: 10,",
        "    paddingHorizontal: 4,",
        "    paddingVertical: 3,",
        "    alignItems: 'center',",
        "    justifyContent: 'center',",
        "  },",
        "});",
      ].join('\n');
      src = src.slice(0, lastIdx) + styleBlock + src.slice(lastIdx + 3);
      ok('appended commentaryBadgeTopRight style');
    }
  }
}

// Save
if (src !== orig && fail === 0) {
  fs.writeFileSync(DETAILS, src, 'utf8');
  ok('saved ' + DETAILS);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV18 done. Rebuild and test:');
  console.log('  ✓ Rick & Morty S1E1 Play → WEB-DL plays (no commentary, real episode)');
  console.log('  ✓ Stream cards now show a tiny gold chat-bubble at top-right when stream is commentary');
  console.log('  ✓ The old "COMM" text badge is gone');
  console.log('  ✓ Movies are unaffected (Blu-ray penalty only fires on series with S##E## titles)');
}
