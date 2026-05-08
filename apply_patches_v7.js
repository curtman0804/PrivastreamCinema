/* eslint-disable */
// apply_patches_v7.js
// Run from project root:   node apply_patches_v7.js
//
// Two fixes:
//   (1) details/[type]/[id].tsx — goToSeriesRootWithFocus now resets the stack
//       to [(tabs), series_root] so back from the series root cleanly lands on
//       the home tab (instead of exiting the app).
//
//   (2) player.tsx — prefetchAndSeek clamps the target position to
//       (duration - 5000ms) so dragging the progress bar past the end no
//       longer triggers ExoPlayer's end-of-video → stream reset path.
//       Also cancels any pending playbackTimeoutRef when the user seeks.

const fs = require('fs');
const path = require('path');

const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');
const PLAYER  = path.join('frontend', 'app', 'player.tsx');

let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

function backup(file) {
  const bak = file + '.bak.' + Date.now();
  fs.copyFileSync(file, bak);
  info('backup → ' + bak);
}

// ====================================================================
// PATCH 1: details/[type]/[id].tsx — back from series root → home tab
// ====================================================================
console.log('\n=== Patching ' + DETAILS + ' ===');

if (!fs.existsSync(DETAILS)) { bad('details file not found'); process.exit(1); }
let details = fs.readFileSync(DETAILS, 'utf8');
const detailsOrig = details;
backup(DETAILS);

{
  const MARKER = 'PATCH_V7_HOME_TAB';
  if (details.includes(MARKER)) {
    ok('V7 home-tab base already in goToSeriesRootWithFocus');
  } else {
    // Match the V6 reset block we installed (single-route reset)
    const oldReset = [
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
    ].join('\n');

    const newReset = [
      "      // " + MARKER + " — keep (tabs) base so back from series root lands on home",
      "      navigation.dispatch(",
      "        CommonActions.reset({",
      "          index: 1,",
      "          routes: [",
      "            { name: '(tabs)' },",
      "            {",
      "              name: 'details/[type]/[id]',",
      "              params: { type: type as string, id: baseIdLocal, selectedSeason: s, selectedEpisode: e },",
      "            },",
      "          ],",
      "        }) as any",
      "      );",
    ].join('\n');

    if (details.includes(oldReset)) {
      details = details.replace(oldReset, newReset);
      ok('goToSeriesRootWithFocus now resets to [(tabs), series_root]');
    } else {
      bad('could not find V6 reset block — leaving details untouched');
    }
  }
}

if (details !== detailsOrig) {
  fs.writeFileSync(DETAILS, details, 'utf8');
  ok('saved ' + DETAILS);
} else {
  info('no changes needed to ' + DETAILS);
}

// ====================================================================
// PATCH 2: player.tsx — clamp seek 5s before end, kill restart timeout on seek
// ====================================================================
console.log('\n=== Patching ' + PLAYER + ' ===');

if (!fs.existsSync(PLAYER)) { bad('player file not found'); process.exit(1); }
let player = fs.readFileSync(PLAYER, 'utf8');
const playerOrig = player;
backup(PLAYER);

// 2a — clamp seek
{
  const MARKER = 'PATCH_V7_SAFE_CLAMP';
  if (player.includes(MARKER)) {
    ok('V7 seek-clamp already installed');
  } else {
    const oldClamp = "    const clampedPosition = Math.max(0, Math.min(duration, targetMs));";
    const newClamp = [
      "    // " + MARKER + " — keep at least 5s away from the very end so a long",
      "    // drag past the duration doesn't fire ExoPlayer's end-of-video reset.",
      "    const safeMax = duration > 5000 ? duration - 5000 : Math.max(0, duration - 1);",
      "    const clampedPosition = Math.max(0, Math.min(safeMax, targetMs));",
    ].join('\n');

    if (player.includes(oldClamp)) {
      player = player.replace(oldClamp, newClamp);
      ok('seek now clamps to (duration - 5s) max');
    } else {
      bad('could not find existing clamp line — leaving seek logic alone');
    }
  }
}

// 2b — kill the pending stream-restart timeout when user seeks
{
  const MARKER = 'PATCH_V7_KILL_TIMEOUT_ON_SEEK';
  if (player.includes(MARKER)) {
    ok('V7 timeout-kill on seek already installed');
  } else {
    // Insert right after `setIsRebuffering(true);` which runs on every seek
    const anchor = [
      "    isSeekingRef.current = true;",
      "    lastSeekPositionRef.current = clampedPosition;",
      "    setIsRebuffering(true);",
      "    showControlsWithTimeout();",
    ].join('\n');

    const replacement = [
      "    isSeekingRef.current = true;",
      "    lastSeekPositionRef.current = clampedPosition;",
      "    setIsRebuffering(true);",
      "    showControlsWithTimeout();",
      "",
      "    // " + MARKER + " — a user-initiated seek must NOT trigger tryNextStream.",
      "    // Cancel the 30s 'no playback yet' timeout that may still be armed.",
      "    if (playbackTimeoutRef.current) {",
      "      try { clearTimeout(playbackTimeoutRef.current); } catch (_) {}",
      "      playbackTimeoutRef.current = null;",
      "    }",
    ].join('\n');

    if (player.includes(anchor)) {
      player = player.replace(anchor, replacement);
      ok('seek now cancels pending stream-restart timeout');
    } else {
      bad('could not find seek-init anchor — leaving timeout logic alone');
    }
  }
}

if (player !== playerOrig) {
  fs.writeFileSync(PLAYER, player, 'utf8');
  ok('saved ' + PLAYER);
} else {
  info('no changes needed to ' + PLAYER);
}

// ====================================================================
console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV7 installed. Rebuild the APK and test:');
  console.log('  ✓ Back from series root → home tab (no app exit)');
  console.log('  ✓ Drag progress bar to the very end → stays in episode (no reset)');
  console.log('\n(Loading-screen visual unification will be tackled in V8.)');
}
