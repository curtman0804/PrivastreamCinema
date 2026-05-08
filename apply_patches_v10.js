/* eslint-disable */
// apply_patches_v10.js
// Run from project root:   node apply_patches_v10.js
//
// FIX: dragging to a position too far ahead of the buffer triggered a chain
// of onError events. The seek-retry branch returned correctly the first time,
// but after exhausting its 3 retries it cleared isSeekingRef and let the
// next onError fall through to the GENERAL retry path → tryNextStream →
// full stream reset. User saw playback restart from zero.
//
// V10 changes the onError flow so that:
//   1. We snapshot the pre-seek position before every drag.
//   2. When seek-retry exhausts, we REWIND to the pre-seek position
//      (instead of just clearing state) AND set a post-seek cooldown.
//   3. ALL subsequent onError calls during the cooldown become no-ops —
//      no retry, no tryNextStream, no reset.
//
// Result: a failed long-distance seek now leaves the user playing from
// where they were, NOT from the start.

const fs = require('fs');
const path = require('path');

const PLAYER = path.join('frontend', 'app', 'player.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(PLAYER)) { bad('player.tsx not found'); process.exit(1); }

let src = fs.readFileSync(PLAYER, 'utf8');
const orig = src;
const bak = PLAYER + '.bak.v10.' + Date.now();
fs.copyFileSync(PLAYER, bak);
info('backup → ' + bak);

console.log('\n=== Patching ' + PLAYER + ' ===');

// ----------------------------------------------------------------
// 1. Add preSeekPositionRef + seekCooldownUntilRef refs
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V10_SEEK_GUARDS';
  if (src.includes(MARKER)) {
    ok('V10 seek guard refs already declared');
  } else {
    const anchor = '  const isSeekingRef = useRef(false);';
    if (!src.includes(anchor)) {
      bad('could not find isSeekingRef anchor');
    } else {
      const replacement = [
        '  const isSeekingRef = useRef(false);',
        '  // ' + MARKER + ' — track pre-seek position so we can rewind on seek failure,',
        '  // plus a cooldown timestamp so onError storms after a failed seek do not reset the stream.',
        '  const preSeekPositionMsRef = useRef<number>(0);',
        '  const seekCooldownUntilRef = useRef<number>(0);',
      ].join('\n');
      src = src.replace(anchor, replacement);
      ok('declared preSeekPositionMsRef + seekCooldownUntilRef');
    }
  }
}

// ----------------------------------------------------------------
// 2. Snapshot the current position before seeking
//    Insert right after `isSeekingRef.current = true;` inside prefetchAndSeek.
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V10_SNAPSHOT';
  if (src.includes(MARKER)) {
    ok('V10 pre-seek snapshot already in place');
  } else {
    const anchor = [
      "    isSeekingRef.current = true;",
      "    lastSeekPositionRef.current = clampedPosition;",
      "    setIsRebuffering(true);",
    ].join('\n');

    const replacement = [
      "    isSeekingRef.current = true;",
      "    lastSeekPositionRef.current = clampedPosition;",
      "    // " + MARKER + " — capture pre-seek position so onError can rewind us if the seek fails",
      "    try { preSeekPositionMsRef.current = positionRef.current || 0; } catch (_) { preSeekPositionMsRef.current = 0; }",
      "    setIsRebuffering(true);",
    ].join('\n');

    if (src.includes(anchor)) {
      src = src.replace(anchor, replacement);
      ok('snapshot of pre-seek position now captured before each seek');
    } else {
      bad('could not find prefetchAndSeek anchor for snapshot');
    }
  }
}

// ----------------------------------------------------------------
// 3. On seek-retry exhaustion: rewind + arm cooldown (instead of falling
//    through). Replace the giveup-block lines 2200-2205 region.
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V10_REWIND_ON_GIVEUP';
  if (src.includes(MARKER)) {
    ok('V10 rewind-on-giveup already installed');
  } else {
    const oldBlock = [
      "                        videoRetryCountRef.current += 1;",
      "                        if (videoRetryCountRef.current > 3) {",
      "                          isSeekingRef.current = false;",
      "                          videoRetryCountRef.current = 0;",
      "                          setIsRebuffering(false);",
      "                        }",
    ].join('\n');

    const newBlock = [
      "                        videoRetryCountRef.current += 1;",
      "                        if (videoRetryCountRef.current > 3) {",
      "                          // " + MARKER + " — rewind to pre-seek position and arm",
      "                          // cooldown so subsequent onError events do not trigger tryNextStream.",
      "                          isSeekingRef.current = false;",
      "                          videoRetryCountRef.current = 0;",
      "                          setIsRebuffering(false);",
      "                          seekCooldownUntilRef.current = Date.now() + 10000;",
      "                          if (videoRef.current && preSeekPositionMsRef.current > 0) {",
      "                            try {",
      "                              await videoRef.current.setPositionAsync(preSeekPositionMsRef.current);",
      "                              console.log('[PLAYER] Seek failed — rewound to pre-seek position', preSeekPositionMsRef.current);",
      "                            } catch (_) {}",
      "                          }",
      "                        }",
    ].join('\n');

    if (src.includes(oldBlock)) {
      src = src.replace(oldBlock, newBlock);
      ok('seek-giveup now rewinds to pre-seek position + arms cooldown');
    } else {
      bad('could not find seek-giveup block to patch');
    }
  }
}

// ----------------------------------------------------------------
// 4. Make the GENERAL retry path bail out during the post-seek cooldown.
//    Insert the cooldown check at the top of the fallthrough retry block.
// ----------------------------------------------------------------
{
  const MARKER = 'PATCH_V10_COOLDOWN_GUARD';
  if (src.includes(MARKER)) {
    ok('V10 cooldown guard already in onError fall-through');
  } else {
    const anchor = "                  // Retry aggressively - torrent data arrives progressively, each retry may succeed";
    if (!src.includes(anchor)) {
      bad('could not find general-retry anchor for cooldown guard');
    } else {
      const insert = [
        "                  // " + MARKER + " — if a seek just failed, ignore the onError storm.",
        "                  // ExoPlayer keeps emitting errors at the bad position; we already rewound.",
        "                  if (Date.now() < seekCooldownUntilRef.current) {",
        "                    console.log('[PLAYER] post-seek cooldown active, ignoring onError');",
        "                    return;",
        "                  }",
        "",
        "                  // Retry aggressively - torrent data arrives progressively, each retry may succeed",
      ].join('\n');
      src = src.replace(anchor, insert);
      ok('cooldown guard installed in general retry path');
    }
  }
}

// Save
if (src !== orig) {
  fs.writeFileSync(PLAYER, src, 'utf8');
  ok('saved ' + PLAYER);
} else {
  info('no changes — already patched or anchors not found');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nSome patches failed. Originals are safe in .bak files.');
  process.exit(1);
} else {
  console.log('\nV10 installed. Rebuild the APK and test:');
  console.log('  ✓ Drag the progress bar far ahead → if seek fails, you stay where you were');
  console.log('  ✓ No more "stream resets to start" after a failed long drag');
}
