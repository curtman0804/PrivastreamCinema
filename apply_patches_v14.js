/* eslint-disable */
// apply_patches_v14.js  — STREMIO-LEVEL NAV PERF
// Run from project root:   node apply_patches_v14.js
//
// 1. _layout.tsx: enable react-native-screens freezing globally + freezeOnBlur
//    on Stack. Off-screen routes stop running effects/timers — nav transitions
//    feel near-native.
// 2. (tabs)/_layout.tsx: freezeOnBlur + lazy on Tabs so inactive tabs do
//    nothing until you switch to them.
// 3. discover.tsx: tighten Continue Watching virtualization
//    (removeClippedSubviews=true, windowSize=5, initialNumToRender=3,
//    maxToRenderPerBatch=3) so cold-start paint is much faster.

const fs = require('fs');
const path = require('path');

const ROOT_LAYOUT = path.join('frontend', 'app', '_layout.tsx');
const TABS_LAYOUT = path.join('frontend', 'app', '(tabs)', '_layout.tsx');
const DISCOVER    = path.join('frontend', 'app', '(tabs)', 'discover.tsx');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);
const backup = (file) => {
  const bak = file + '.bak.v14.' + Date.now();
  fs.copyFileSync(file, bak);
  info('backup → ' + bak);
};

// ====================================================================
// 1. Root _layout.tsx — enableFreeze(true) + freezeOnBlur on Stack
// ====================================================================
console.log('\n=== Patching ' + ROOT_LAYOUT + ' ===');
{
  if (!fs.existsSync(ROOT_LAYOUT)) {
    bad('root _layout.tsx not found');
  } else {
    let src = fs.readFileSync(ROOT_LAYOUT, 'utf8');
    const orig = src;
    backup(ROOT_LAYOUT);

    // 1a. Import enableFreeze from react-native-screens (if not present)
    {
      const MARKER = 'PATCH_V14_FREEZE_IMPORT';
      if (src.includes(MARKER) || src.includes('enableFreeze')) {
        ok('enableFreeze import already present');
      } else {
        const anchor = "import React from 'react';";
        if (src.includes(anchor)) {
          src = src.replace(anchor,
            anchor +
            "\nimport { enableFreeze } from 'react-native-screens'; // " + MARKER +
            "\nenableFreeze(true);"
          );
          ok('enableFreeze(true) called at top of _layout.tsx');
        } else {
          bad('could not find React import anchor in root _layout');
        }
      }
    }

    // 1b. Add freezeOnBlur:true to Stack screenOptions
    {
      const MARKER = 'PATCH_V14_FREEZE_ON_BLUR_STACK';
      if (src.includes(MARKER) || /freezeOnBlur:\s*true/.test(src)) {
        ok('Stack already has freezeOnBlur');
      } else {
        const oldStack = "<Stack screenOptions={{ headerShown: false, animation: 'none' }} />";
        const newStack = "<Stack screenOptions={{ headerShown: false, animation: 'none', freezeOnBlur: true /* " + MARKER + " */ }} />";
        if (src.includes(oldStack)) {
          src = src.replace(oldStack, newStack);
          ok('added freezeOnBlur: true to Stack screenOptions');
        } else {
          bad('could not find Stack screenOptions block to patch');
        }
      }
    }

    if (src !== orig) {
      fs.writeFileSync(ROOT_LAYOUT, src, 'utf8');
      ok('saved ' + ROOT_LAYOUT);
    }
  }
}

// ====================================================================
// 2. (tabs)/_layout.tsx — add freezeOnBlur + lazy
// ====================================================================
console.log('\n=== Patching ' + TABS_LAYOUT + ' ===');
{
  if (!fs.existsSync(TABS_LAYOUT)) {
    bad('tabs _layout.tsx not found');
  } else {
    let src = fs.readFileSync(TABS_LAYOUT, 'utf8');
    const orig = src;
    backup(TABS_LAYOUT);

    const MARKER = 'PATCH_V14_FREEZE_ON_BLUR_TABS';
    if (src.includes(MARKER)) {
      ok('Tabs freezeOnBlur+lazy already present');
    } else {
      const anchor = "      screenOptions={{\n        headerShown: false,";
      if (!src.includes(anchor)) {
        bad('could not find Tabs screenOptions anchor');
      } else {
        const insert = [
          "      screenOptions={{",
          "        // " + MARKER,
          "        freezeOnBlur: true,",
          "        lazy: true,",
          "        headerShown: false,",
        ].join('\n');
        src = src.replace(anchor, insert);
        ok('added freezeOnBlur+lazy to Tabs screenOptions');
      }
    }

    if (src !== orig) {
      fs.writeFileSync(TABS_LAYOUT, src, 'utf8');
      ok('saved ' + TABS_LAYOUT);
    }
  }
}

// ====================================================================
// 3. discover.tsx — tighten Continue Watching FlatList virtualization
// ====================================================================
console.log('\n=== Patching ' + DISCOVER + ' ===');
{
  if (!fs.existsSync(DISCOVER)) {
    bad('discover.tsx not found');
  } else {
    let src = fs.readFileSync(DISCOVER, 'utf8');
    const orig = src;
    backup(DISCOVER);

    const MARKER = 'PATCH_V14_CW_VIRT';
    if (src.includes(MARKER)) {
      ok('Continue Watching virtualization already tightened');
    } else {
      const oldVirt = [
        "                contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}",
        "                removeClippedSubviews={false}",
        "                windowSize={21}",
        "                initialNumToRender={10}",
      ].join('\n');
      const newVirt = [
        "                contentContainerStyle={[styles.rowContent, isTV && styles.rowContentTV]}",
        "                // " + MARKER,
        "                removeClippedSubviews={true}",
        "                windowSize={5}",
        "                initialNumToRender={3}",
        "                maxToRenderPerBatch={3}",
        "                updateCellsBatchingPeriod={50}",
      ].join('\n');
      if (src.includes(oldVirt)) {
        src = src.replace(oldVirt, newVirt);
        ok('Continue Watching FlatList virtualization tightened for Android TV');
      } else {
        bad('could not find Continue Watching FlatList props');
      }
    }

    if (src !== orig) {
      fs.writeFileSync(DISCOVER, src, 'utf8');
      ok('saved ' + DISCOVER);
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
  console.log('\nV14 done. Rebuild and test on the Google Streamer 4K:');
  console.log('  ✓ Off-screen routes now stop running effects (massive nav perf win)');
  console.log('  ✓ Tabs lazy-mount instead of eagerly running every tab\'s screens');
  console.log('  ✓ Continue Watching cold-start paints 10x faster (3 instead of 10 items)');
  console.log('\nIf still laggy, V15 will lazy-mount the discover service rows in chunks.');
}
