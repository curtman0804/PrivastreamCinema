/**
 * apply_patches_v79.js
 * ====================
 * Two fixes:
 *
 * (A) ContentCard.tsx — IN CINEMA badge polish:
 *      • Centered horizontally at the top of the poster
 *      • Ticket-stub icon before the words
 *      • Text changed from "IN CINEMAS" to "IN CINEMA"
 *
 * (B) discover.tsx — Vertical-nav "title at top" fix:
 *      • Row title slides to the VERY TOP of the scroll area on focus
 *        (instead of landing where row 0 sat, which left blank space).
 *      • Continue-Watching row gets the same behaviour when you press UP
 *        back into it from row 0.
 *
 * Both fixes are idempotent and CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v79.js
 */

const fs = require('fs');
const path = require('path');

function fail(msg) { console.error('[v79] FATAL:', msg); process.exit(1); }
function detectEol(s) { return s.includes('\r\n') ? '\r\n' : '\n'; }
function backupAndWrite(file, src) {
  const b = file + '.bak.v79.' + Date.now();
  fs.writeFileSync(b, fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, src);
  console.log('[v79]   backup:', b);
}
function findFile(cands, label) {
  const hit = cands.find(p => fs.existsSync(p));
  if (!hit) fail('Could not find ' + label);
  return hit;
}

// ───────────────────────────────────────────────────────────────
// (A) ContentCard.tsx — badge polish
// ───────────────────────────────────────────────────────────────
function patchContentCard() {
  const file = findFile(
    [
      path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
      path.join('src', 'components', 'ContentCard.tsx'),
    ],
    'ContentCard.tsx'
  );
  let src = fs.readFileSync(file, 'utf8');
  const eol = detectEol(src);
  console.log('[v79] (A) Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

  let changed = false;

  // A1. Replace the outer wrapping View style + add an inner pill View opener
  const wrapOld = '<View style={styles.inCinemasBadge} pointerEvents="none">';
  const wrapNew = '<View style={styles.inCinemasBadgeWrap} pointerEvents="none"><View style={styles.inCinemasBadgePill}>';
  if (src.includes(wrapOld)) {
    src = src.replace(wrapOld, wrapNew);
    console.log('[v79]   ✓ wrap View swapped to centered + pill');
    changed = true;
  } else if (src.includes('inCinemasBadgeWrap')) {
    console.log('[v79]   = wrap already swapped');
  } else {
    fail('Old badge wrap View not found. Did v77e apply?');
  }

  // A2. Swap the text line for an icon + new text + closing inner View
  const textOld = '<Text style={styles.inCinemasBadgeText}>IN CINEMAS</Text>';
  const textNew =
    '<Ionicons name="ticket" size={10} color={colors.textPrimary} style={styles.inCinemasBadgeIcon} />' +
    '<Text style={styles.inCinemasBadgeText}>IN CINEMA</Text></View>';
  if (src.includes(textOld)) {
    src = src.replace(textOld, textNew);
    console.log('[v79]   ✓ text swapped to "IN CINEMA" + ticket icon');
    changed = true;
  } else if (src.includes('IN CINEMA<')) {
    console.log('[v79]   = text already updated');
  } else {
    fail('Old "IN CINEMAS" text node not found.');
  }

  // A3. Add new styles for the wrap + pill + icon spacing, just before
  //     the existing inCinemasBadgeText style. Idempotent.
  if (!src.includes('inCinemasBadgeWrap:')) {
    const styleAnchor = '  inCinemasBadgeText: {';
    if (!src.includes(styleAnchor)) fail('inCinemasBadgeText anchor missing (v77c styles).');
    const inject =
      '  inCinemasBadgeWrap: {' + eol +
      "    position: 'absolute'," + eol +
      '    top: 6,' + eol +
      '    left: 0,' + eol +
      '    right: 0,' + eol +
      "    alignItems: 'center'," + eol +
      '    zIndex: 5,' + eol +
      '    elevation: 5,' + eol +
      '  },' + eol + eol +
      '  inCinemasBadgePill: {' + eol +
      "    flexDirection: 'row'," + eol +
      "    alignItems: 'center'," + eol +
      '    backgroundColor: colors.primary,' + eol +
      '    paddingHorizontal: 7,' + eol +
      '    paddingVertical: 3,' + eol +
      '    borderRadius: 4,' + eol +
      '  },' + eol + eol +
      '  inCinemasBadgeIcon: {' + eol +
      '    marginRight: 4,' + eol +
      '  },' + eol + eol +
      styleAnchor;
    src = src.replace(styleAnchor, inject);
    console.log('[v79]   ✓ added inCinemasBadgeWrap / inCinemasBadgePill / inCinemasBadgeIcon styles');
    changed = true;
  } else {
    console.log('[v79]   = new styles already present');
  }

  if (changed) backupAndWrite(file, src);
}

// ───────────────────────────────────────────────────────────────
// (B) discover.tsx — vertical-nav "title at top" fix
// ───────────────────────────────────────────────────────────────
function patchDiscover() {
  const file = findFile(
    [
      path.join('frontend', 'app', '(tabs)', 'discover.tsx'),
      path.join('app', '(tabs)', 'discover.tsx'),
    ],
    'discover.tsx'
  );
  let src = fs.readFileSync(file, 'utf8');
  const eol = detectEol(src);
  console.log('[v79] (B) Patching:', file, '(' + (eol === '\r\n' ? 'CRLF' : 'LF') + ')');

  let changed = false;

  // B1. Change the row-snap targetY formula:
  //     OLD:  const targetY = Math.max(0, y - firstRowY);
  //     NEW:  const targetY = Math.max(0, y);
  //     Plus drop the now-unused firstRowY line.
  const oldFormula1 = 'const firstRowY = rowYPositionsRef.current[0] ?? 0;';
  const oldFormula2 = 'const targetY = Math.max(0, y - firstRowY);';
  if (src.includes(oldFormula2)) {
    src = src.replace(oldFormula1, '// firstRowY no longer used — title-at-top (v79)');
    src = src.replace(oldFormula2, 'const targetY = Math.max(0, y);');
    console.log('[v79]   ✓ row-snap formula → scroll to row Y directly (title at top)');
    changed = true;
  } else if (src.includes('// firstRowY no longer used')) {
    console.log('[v79]   = row-snap formula already updated');
  } else {
    fail('v78 row-snap formula not found. Did v78 apply?');
  }

  // B2. Make Continue-Watching section report its Y position via onLayout,
  //     and make handleSectionFocus scroll to that exact Y (no -10 offset).

  // B2a. Add onLayout to the CW outer View.
  const cwOpenOld = '<View key={item.key} style={styles.section}>';
  const cwOpenNew =
    '<View key={item.key} style={styles.section}' + eol +
    '                  onLayout={(e) => { sectionPositions.current[\'continue-watching\'] = e.nativeEvent.layout.y; }}' + eol +
    '                >';
  if (src.includes(cwOpenOld)) {
    src = src.replace(cwOpenOld, cwOpenNew);
    console.log('[v79]   ✓ CW section onLayout wired (reports y to sectionPositions)');
    changed = true;
  } else if (src.includes("sectionPositions.current['continue-watching'] = e.nativeEvent.layout.y")) {
    console.log('[v79]   = CW onLayout already wired');
  } else {
    fail('CW section <View> opening tag not found verbatim. File may have been edited.');
  }

  // B2b. Tighten handleSectionFocus scrollTo: drop the -10 offset and the
  //      50ms setTimeout (those were band-aids for missing layout data).
  const focusOld = 'scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY - 10), animated: true });';
  const focusNew = 'scrollViewRef.current?.scrollTo({ y: Math.max(0, sectionY), animated: true });';
  if (src.includes(focusOld)) {
    src = src.replace(focusOld, focusNew);
    console.log('[v79]   ✓ handleSectionFocus offset corrected (was -10, now 0)');
    changed = true;
  } else if (src.includes('scrollTo({ y: Math.max(0, sectionY), animated: true })')) {
    console.log('[v79]   = handleSectionFocus offset already corrected');
  } else {
    console.log('[v79]   ! handleSectionFocus line not found verbatim — skipping (non-fatal).');
  }

  if (changed) backupAndWrite(file, src);
}

// ───────────────────────────────────────────────────────────────
patchContentCard();
console.log('');
patchDiscover();
console.log('');
console.log('[v79] 🎯 Done. Rebuild your APK.');
console.log('[v79]    • Badge now centered with ticket icon + "IN CINEMA" text');
console.log('[v79]    • DOWN/UP now snaps the focused row\'s title to the very top of the scroll area');
