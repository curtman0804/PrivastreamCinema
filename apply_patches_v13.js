/* eslint-disable */
// apply_patches_v13.js  — Commentary badge on StreamCard
// Run from project root:   node apply_patches_v13.js
//
// Adds a small chat-bubble badge to commentary streams so they're visually
// obvious even though they're already deprioritized to the bottom of the
// list by V12. This surfaces "this is a commentary track" at a glance.

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
const bak = DETAILS + '.bak.v13.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// 1. Destructure isCommentary in StreamCard
{
  const oldDestr = "  const { quality, source, size, seeders, language, isForeign } = parseStreamInfo(stream);";
  const newDestr = "  const { quality, source, size, seeders, language, isForeign, isCommentary } = parseStreamInfo(stream);";
  if (src.includes(newDestr)) {
    ok('StreamCard already destructures isCommentary');
  } else if (src.includes(oldDestr)) {
    src = src.replace(oldDestr, newDestr);
    ok('StreamCard now destructures isCommentary');
  } else {
    bad('could not find StreamCard parseStreamInfo destructure');
  }
}

// 2. Add commentary badge in the badge row, BEFORE the quality badge
{
  const MARKER = 'PATCH_V13_COMMENTARY_BADGE';
  if (src.includes(MARKER)) {
    ok('commentary badge already present');
  } else {
    const oldBadgeRow = [
      "          <View style={[",
      "            styles.langBadge,",
      "            isForeign ? styles.langBadgeForeign : styles.langBadgeEnglish",
      "          ]}>",
      "            <Text style={[",
      "              styles.langBadgeText,",
      "              isForeign ? styles.langBadgeTextForeign : styles.langBadgeTextEnglish",
      "            ]}>{language}</Text>",
      "          </View>",
    ].join('\n');

    const newBadgeRow = [
      "          {/* " + MARKER + " */}",
      "          {isCommentary && (",
      "            <View style={styles.commentaryBadge}>",
      "              <Ionicons name=\"chatbubble\" size={11} color=\"#FF8C00\" />",
      "              <Text style={styles.commentaryBadgeText}>COMM</Text>",
      "            </View>",
      "          )}",
      "          <View style={[",
      "            styles.langBadge,",
      "            isForeign ? styles.langBadgeForeign : styles.langBadgeEnglish",
      "          ]}>",
      "            <Text style={[",
      "              styles.langBadgeText,",
      "              isForeign ? styles.langBadgeTextForeign : styles.langBadgeTextEnglish",
      "            ]}>{language}</Text>",
      "          </View>",
    ].join('\n');

    if (src.includes(oldBadgeRow)) {
      src = src.replace(oldBadgeRow, newBadgeRow);
      ok('commentary badge JSX inserted before lang badge');
    } else {
      bad('could not find lang-badge row in StreamCard');
    }
  }
}

// 3. Add the styles
{
  const MARKER = 'PATCH_V13_BADGE_STYLES';
  if (src.includes(MARKER)) {
    ok('commentary badge styles already in stylesheet');
  } else {
    // Inject at the end of StyleSheet.create object — anchor on the closing `});`
    // Find a known existing entry near the bottom and add ours just before the close.
    const anchor = "});";  // last close of StyleSheet.create — careful: there may be many; we want the very last one in the file
    // To avoid false hits, find the LAST "});" in the file
    const lastIdx = src.lastIndexOf(anchor);
    if (lastIdx < 0) {
      bad('could not find StyleSheet.create close brace');
    } else {
      const styles = [
        "  // " + MARKER,
        "  commentaryBadge: {",
        "    flexDirection: 'row',",
        "    alignItems: 'center',",
        "    gap: 4,",
        "    backgroundColor: 'rgba(255,140,0,0.18)',",
        "    borderColor: '#FF8C00',",
        "    borderWidth: 1,",
        "    borderRadius: 4,",
        "    paddingHorizontal: 6,",
        "    paddingVertical: 2,",
        "  },",
        "  commentaryBadgeText: {",
        "    color: '#FF8C00',",
        "    fontSize: 10,",
        "    fontWeight: '700',",
        "    letterSpacing: 0.5,",
        "  },",
        "});",
      ].join('\n');
      src = src.slice(0, lastIdx) + styles + src.slice(lastIdx + anchor.length);
      ok('added commentaryBadge + commentaryBadgeText styles');
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
  console.log('\nV13 done. Rebuild — commentary streams now show an orange COMM badge.');
}
