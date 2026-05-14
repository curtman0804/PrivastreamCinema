/* eslint-disable */
// diagnose_player_cleanup.js — READ-ONLY inspection for V30.
// Goal: find out WHY the next play attempt hangs forever after watching a movie.
//
// Hypothesis: player.tsx unmount does not reset `isLoadingStreams` /
// `streams` / `currentStream` in contentStore.ts. Next play boots the
// stream loader, but the store still says isLoadingStreams=true (or
// the streams array is non-empty stale data), so the UI sticks.
//
// This script prints (does NOT modify) the relevant slices of:
//   - frontend/app/player.tsx           (mount/unmount lifecycle)
//   - frontend/src/store/contentStore.ts (state shape + actions)
//   - frontend/app/details/[type]/[id].tsx (how `playStream` is invoked)
//
// Run from project root:  node diagnose_player_cleanup.js  > diag_v30.txt
// Then paste diag_v30.txt back to me.

const fs = require('fs');
const path = require('path');

const PLAYER  = path.join('frontend', 'app', 'player.tsx');
const STORE   = path.join('frontend', 'src', 'store', 'contentStore.ts');
const DETAILS = path.join('frontend', 'app', 'details', '[type]', '[id].tsx');

function header(t) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + t);
  console.log('='.repeat(70));
}

function showFileMeta(label, p) {
  if (!fs.existsSync(p)) { console.log('  [MISSING] ' + p); return null; }
  const src = fs.readFileSync(p, 'utf8');
  const lines = src.split(/\r?\n/);
  console.log('  ' + label + ': ' + p);
  console.log('    lines      : ' + lines.length);
  console.log('    line ending: ' + (src.indexOf('\r\n') >= 0 ? 'CRLF' : 'LF'));
  console.log('    size       : ' + src.length + ' bytes');
  return { src: src, lines: lines };
}

function printMatches(label, src, regex, contextLinesBefore, contextLinesAfter) {
  const lines = src.split(/\r?\n/);
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    if (regex.test(lines[i])) found.push(i);
  }
  console.log('\n  -- ' + label + ' (' + found.length + ' match' + (found.length === 1 ? '' : 'es') + ') --');
  if (found.length === 0) { console.log('    (none)'); return; }
  for (const i of found) {
    const a = Math.max(0, i - contextLinesBefore);
    const b = Math.min(lines.length - 1, i + contextLinesAfter);
    console.log('    [L' + (i + 1) + ']');
    for (let k = a; k <= b; k++) {
      const mark = (k === i) ? ' >> ' : '    ';
      console.log('    L' + (k + 1).toString().padStart(4) + mark + lines[k]);
    }
    console.log('    ----');
  }
}

console.log('# diagnose_player_cleanup.js — read-only');
console.log('# generated: ' + new Date().toISOString());
console.log('# cwd: ' + process.cwd());

// ---------------------------------------------------------------------
header('FILE META');
const player  = showFileMeta('player ', PLAYER);
const store   = showFileMeta('store  ', STORE);
const details = showFileMeta('details', DETAILS);

// ---------------------------------------------------------------------
header('player.tsx — useEffect lifecycle, cleanup, unmount paths');
if (player) {
  // 1. All useEffect blocks (just the opening line, with a bit of context)
  printMatches('useEffect openings', player.src, /useEffect\s*\(/, 0, 1);

  // 2. All `return () =>` cleanup arrows inside hooks
  printMatches('useEffect cleanup arrows (return () => ...)', player.src, /return\s*\(\s*\)\s*=>/, 1, 3);

  // 3. unmount/back/exit/dismiss patterns
  printMatches('player.remove / player.release / player.pause / player.unload',
    player.src, /\.(remove|release|unload|pause|stop)\s*\(/, 0, 1);

  // 4. router.back / router.replace / router.push from player
  printMatches('router.back / router.replace / router.push',
    player.src, /router\.(back|replace|push|dismiss)\s*\(/, 0, 1);

  // 5. Where player reads streams / currentStream / isLoadingStreams
  printMatches('store reads in player', player.src,
    /(useContentStore|isLoadingStreams|currentStream|streams\b|setCurrentStream|setStreams)/, 0, 0);

  // 6. Top-level imports of contentStore
  printMatches('contentStore imports', player.src, /from\s+['"][^'"]*contentStore['"]/, 0, 0);

  // 7. Component default export / function header (helps locate unmount anchor)
  printMatches('export default / function Player',
    player.src, /(export\s+default|function\s+Player|const\s+Player\s*=)/, 0, 0);
}

// ---------------------------------------------------------------------
header('contentStore.ts — state shape + playback-related actions');
if (store) {
  // 1. State field declarations
  printMatches('state fields (isLoadingStreams, streams, currentStream, error, …)',
    store.src,
    /(isLoadingStreams\s*:|currentStream\s*:|^\s*streams\s*:|^\s*error\s*:|setStreams\s*:|setCurrentStream\s*:|resetStreams|resetPlayback|clearStreams)/m,
    0, 0);

  // 2. Action signatures (setX, clearX, resetX)
  printMatches('action signatures', store.src,
    /^\s*(set|clear|reset|fetch)[A-Z][A-Za-z]*\s*[:(]/m, 0, 1);

  // 3. fetchStreams entry — to see what it overwrites
  printMatches('fetchStreams body — what gets reset on entry',
    store.src,
    /set\s*\(\s*\{\s*isLoadingStreams\s*:/, 1, 6);

  // 4. The store create<...>() type — shows full state contract
  printMatches('create<...> type (top of store)',
    store.src, /create<\s*[A-Za-z]/, 0, 30);

  // 5. Any existing reset helpers
  printMatches('any reset / clear in store',
    store.src, /\b(reset|clear)[A-Z][A-Za-z]+\b/, 0, 1);
}

// ---------------------------------------------------------------------
header('details/[type]/[id].tsx — how playback is launched');
if (details) {
  // 1. router.push('/player' …) — the launch point
  printMatches("router.push('/player' …)",
    details.src, /router\.(push|replace|navigate)\s*\(\s*['"`][^'"`]*player/, 0, 3);

  // 2. setCurrentStream / fetchStreams / playStream calls
  printMatches('setCurrentStream / playStream / fetchStreams calls in details',
    details.src,
    /(setCurrentStream|playStream|fetchStreams)\s*\(/, 0, 1);
}

// ---------------------------------------------------------------------
header('SUMMARY for V30 anchor choice');
console.log('  Look at the output above and tell me (or just paste it back):');
console.log('    1. Does contentStore.ts have a `resetStreams` / `resetPlayback` action? (Y/N)');
console.log('    2. Does player.tsx already have a `return () => { ... }` cleanup');
console.log('       inside any useEffect? (Y/N)');
console.log('    3. Line number of the first useEffect in player.tsx? (it will be V30 anchor)');
console.log('    4. Confirm: state field names are exactly');
console.log('         isLoadingStreams, streams, currentStream  (Y/N — correct any spelling)');
console.log('\n# done.');
