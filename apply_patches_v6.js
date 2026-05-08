/* eslint-disable */
// apply_patches_v6.js
// Run from project root:   node apply_patches_v6.js
//
// Fixes the back-navigation LOOP on the series root page.
//
// Root cause: details/[type]/[id].tsx -> goToSeriesRootWithFocus() uses
// router.push() to navigate to the series root, which adds yet ANOTHER
// stack entry on top of an already-polluted binge-watch stack. When the
// user then presses back from the series root, default back fires and
// pops to a stale episode entry (FLASH), whose own focus effect re-fires
// goToSeriesRootWithFocus(), creating a loop.
//
// Fix: replace router.push with navigation.dispatch(CommonActions.reset).
// This atomically wipes the entire inner stack and replaces it with just
// [series_root]. Back from series_root cleanly exits to the parent tabs
// navigator (home tab). Zero stale entries = zero loops.

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
const bak = DETAILS + '.bak.' + Date.now();
fs.copyFileSync(DETAILS, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + DETAILS + ' ===');

// --- 1: Ensure useNavigation + CommonActions imported from @react-navigation/native
{
  const re = /import\s*\{([^}]+)\}\s*from\s*['"]@react-navigation\/native['"]/;
  const m = src.match(re);
  if (m) {
    const items = m[1].split(',').map(s => s.trim()).filter(Boolean);
    let changed = false;
    if (!items.includes('useNavigation')) { items.push('useNavigation'); changed = true; }
    if (!items.includes('CommonActions')) { items.push('CommonActions'); changed = true; }
    if (changed) {
      src = src.replace(re, "import { " + items.join(', ') + " } from '@react-navigation/native'");
      ok('added useNavigation/CommonActions to @react-navigation/native import');
    } else {
      ok('useNavigation/CommonActions already imported');
    }
  } else {
    // No @react-navigation/native import yet — add a fresh one after the expo-router import
    const expoRouterRe = /import\s*\{[^}]*useRouter[^}]*\}\s*from\s*['"]expo-router['"];?/;
    if (expoRouterRe.test(src)) {
      src = src.replace(expoRouterRe, (mm) => mm + "\nimport { useNavigation, CommonActions } from '@react-navigation/native';");
      ok('added new import for useNavigation/CommonActions');
    } else {
      bad('could not locate import anchor for @react-navigation/native');
    }
  }
}

// --- 2: Add `const navigation = useNavigation();` right before goToSeriesRootWithFocus
{
  if (/const\s+navigation\s*=\s*useNavigation\(\)/.test(src)) {
    ok('navigation hook already declared');
  } else {
    const anchor = '  const goToSeriesRootWithFocus = useCallback(() => {';
    if (src.includes(anchor)) {
      src = src.replace(anchor, '  const navigation = useNavigation();\n\n' + anchor);
      ok('declared `const navigation = useNavigation()` before goToSeriesRootWithFocus');
    } else {
      bad('could not find goToSeriesRootWithFocus anchor for navigation hook');
    }
  }
}

// --- 3: Replace the body of goToSeriesRootWithFocus with navigation.reset version
{
  const MARKER = 'PATCH_V6_NAV_RESET';
  if (src.includes(MARKER)) {
    ok('V6 navigation.reset already installed in goToSeriesRootWithFocus');
  } else {
    // Match the EXACT existing body of goToSeriesRootWithFocus, from the
    // useCallback opening through to its closing dependency array.
    const oldBody = [
      "  const goToSeriesRootWithFocus = useCallback(() => {",
      "    const idStr = (id as string) || '';",
      "    if (!idStr.includes(':')) return false;",
      "    const parts = idStr.split(':');",
      "    const baseIdLocal = parts[0] || idStr;",
      "    const s = parts[1] || '';",
      "    const e = parts[2] || '';",
      "    try {",
      "      if (typeof (router as any).dismissAll === 'function') (router as any).dismissAll();",
      "    } catch (_) {}",
      "    setTimeout(() => {",
      "      router.push({",
      "        pathname: `/details/${type}/${baseIdLocal}`,",
      "        params: { selectedSeason: s, selectedEpisode: e },",
      "      });",
      "    }, 30);",
      "    return true;",
      "  }, [id, type, router]);",
    ].join('\n');

    const newBody = [
      "  const goToSeriesRootWithFocus = useCallback(() => {",
      "    // " + MARKER + " — atomically resets stack, kills binge pollution",
      "    const idStr = (id as string) || '';",
      "    if (!idStr.includes(':')) return false;",
      "    const parts = idStr.split(':');",
      "    const baseIdLocal = parts[0] || idStr;",
      "    const s = parts[1] || '';",
      "    const e = parts[2] || '';",
      "    try {",
      "      // Wipe the inner stack and replace with ONLY the series_root entry.",
      "      // Back from series_root then cleanly exits to the parent tabs navigator.",
      "      navigation.dispatch(",
      "        CommonActions.reset({",
      "          index: 0,",
      "          routes: [",
      "            {",
      "              name: 'details/[type]/[id]',",
      "              params: { type: type as string, id: baseIdLocal, selectedSeason: s, selectedEpisode: e },",
      "            },",
      "          ],",
      "        }) as any",
      "      );",
      "    } catch (_) {",
      "      // Fallback to old push-based behavior if navigation.reset throws",
      "      try { if (typeof (router as any).dismissAll === 'function') (router as any).dismissAll(); } catch (__) {}",
      "      setTimeout(() => {",
      "        router.push({",
      "          pathname: `/details/${type}/${baseIdLocal}`,",
      "          params: { selectedSeason: s, selectedEpisode: e },",
      "        });",
      "      }, 30);",
      "    }",
      "    return true;",
      "  }, [id, type, router, navigation]);",
    ].join('\n');

    if (src.includes(oldBody)) {
      src = src.replace(oldBody, newBody);
      ok('rewrote goToSeriesRootWithFocus to use navigation.reset (atomic stack wipe)');
    } else {
      bad('could not find expected goToSeriesRootWithFocus body — leaving untouched');
      info('your existing function may have been edited; please re-paste lines 414-431');
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
  console.log('Paste this output back and I will adapt.');
  process.exit(1);
} else {
  console.log('\nV6 installed. Rebuild the APK and test:');
  console.log('  Binge S1E1 → S1E2 → S1E3.');
  console.log('  Back from player → S1E3 episode info.');
  console.log('  Back again → series root (with S3 highlighted).');
  console.log('  Back again → home tab. NO flash. NO loop.');
}
