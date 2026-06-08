/*
 * apply_patches_v181_discover_throttle_and_binge_flash.js
 *
 * V181 — Two-file bundle:
 *   A. Discover screen back-nav lag         (app/(tabs)/discover.tsx)
 *   B. Player binge router.push → replace   (app/player.tsx)
 *
 * (The Search focus-trap fix from the action list is already applied —
 *  SearchBar.tsx has the V165 markers: Keyboard.dismiss() + blurOnSubmit
 *  + inputRef.blur on submit.  Skipped.)
 *
 * ─── A. Discover back-nav lag ────────────────────────────────────────────
 * `lastDiscoverFetchTime` was declared as `useRef<number>(Date.now())` at
 * line 217 — component-scoped.  When the user navigates to Details and
 * back, Discover unmounts and remounts → a fresh ref is created → the 60-s
 * throttle is reset → every back-nav forces a full re-fetch → JS thread
 * freezes for 1-3 s on the D-pad.
 *
 * Fix: lift the timestamp to module scope so it survives unmount/remount.
 * Same logic, but the cooldown now actually cools down between mounts.
 *
 * ─── B. Player binge flash ───────────────────────────────────────────────
 * Player navigates to the next episode via `router.push('/player', ...)`
 * (lines 1196, 1199, 1281, 1284) — which STACKS a new player on top of the
 * existing one.  The old player remains mounted underneath for a moment,
 * its video element shows a black frame, then the new player paints on top.
 * Visually: the screen flashes black between episodes.
 *
 * Fix: use `router.replace(...)` instead.  The old player unmounts atomically
 * before the new one mounts — no overlap, no black flash.
 *
 * ─── Properties ──────────────────────────────────────────────────────────
 * - Idempotent (markers V181_DISCOVER_THROTTLE and V181_BINGE_REPLACE)
 * - CRLF preserved per file
 * - Backups: discover.tsx.v181.bak, player.tsx.v181.bak
 * - Brace balance sanity check
 *
 * Usage
 * -----
 *   cd <expo-project-root>
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v181_discover_throttle_and_binge_flash.js -o apply_patches_v181_discover_throttle_and_binge_flash.js
 *   node apply_patches_v181_discover_throttle_and_binge_flash.js
 *
 * Rebuild the APK after.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();

// File discovery — try multiple plausible Expo Router layouts
const find = (cands) => {
  for (const c of cands) {
    const p = path.join(ROOT, ...c);
    if (fs.existsSync(p)) return p;
  }
  return null;
};
const DISCOVER = find([
  ['app', '(tabs)', 'discover.tsx'],
  ['app', 'discover.tsx'],
  ['app', '(home)', 'discover.tsx'],
]);
const PLAYER = find([
  ['app', 'player.tsx'],
  ['app', '(modals)', 'player.tsx'],
  ['app', 'player', 'index.tsx'],
]);

if (!DISCOVER) { console.error('[v181] FATAL: discover.tsx not found.'); process.exit(1); }
if (!PLAYER)   { console.error('[v181] FATAL: player.tsx not found.');   process.exit(1); }
console.log('[v181] discover:', path.relative(ROOT, DISCOVER));
console.log('[v181] player:  ', path.relative(ROOT, PLAYER));

function read(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return { raw, eol, text: eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw };
}
function write(p, text, eol, raw) {
  const bak = p + '.v181.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v181] wrote ${path.relative(ROOT, p)} (${eol.toUpperCase()}, backup=.v181.bak)`);
}
function braceDelta(t){let d=0,s=null,e=false;for(let i=0;i<t.length;i++){const c=t[i];if(s){if(e){e=false;continue;}if(c==='\\'){e=true;continue;}if(c===s)s=null;continue;}if(c==='/'&&t[i+1]==='/'){const n=t.indexOf('\n',i);i=n===-1?t.length:n;continue;}if(c==='/'&&t[i+1]==='*'){const x=t.indexOf('*/',i+2);i=x===-1?t.length:x+1;continue;}if(c==='"'||c==="'"||c==='`'){s=c;continue;}if(c==='{')d++;if(c==='}')d--;}return d;}

// ═════════════════════════════════════════════════════════════════════════
// PART A — discover.tsx
// ═════════════════════════════════════════════════════════════════════════
const dRead = read(DISCOVER);
let dText = dRead.text;

if (dText.indexOf('V181_DISCOVER_THROTTLE') !== -1) {
  console.log('[v181] discover.tsx: already patched, skipping');
} else {
  // Edit A1 — replace the `useRef<number>(Date.now())` line with a module-level read
  const oldA =
    '  // PATCH_V47_FOCUS_THROTTLE — throttle back-nav refetches to 60s and skip force-refresh.\n' +
    '  // Backing from Details/Player → Discover used to fire fetchDiscover(true)\n' +
    '  // every time, re-rendering every row and causing back-nav lag. SWR in\n' +
    '  // the store already keeps data fresh; we only force-refetch every 60s.\n' +
    '  const lastDiscoverFetchTime = useRef<number>(Date.now());';
  const newA =
    '  // PATCH_V47_FOCUS_THROTTLE + V181_DISCOVER_THROTTLE — same throttle but\n' +
    '  // backed by a module-scope timestamp (see top of file) so the cooldown\n' +
    '  // survives unmount/remount.  Previously the useRef was component-scoped\n' +
    '  // → every back-nav reset the clock → every back-nav re-fetched → 1-3 s\n' +
    '  // JS-thread freeze on the D-pad.  Module scope = real persistence.\n' +
    '  const lastDiscoverFetchTime = { get current(){ return _v181_lastDiscoverFetch; }, set current(v: number){ _v181_lastDiscoverFetch = v; } };';
  if (dText.indexOf(oldA) === -1) { console.error('[v181] FATAL: discover EDIT A1 anchor missed.'); process.exit(2); }
  dText = dText.replace(oldA, newA, 1);

  // Edit A2 — inject the module-level let near the top of the file (after imports)
  // Anchor: find the first `export default function` or `export default const`
  const moduleVar =
    '// V181_DISCOVER_THROTTLE — module-scope timestamp survives unmount/remount.\n' +
    '// Initial value = 0 means \"never fetched\", so the FIRST mount always fetches.\n' +
    'let _v181_lastDiscoverFetch: number = 0;\n\n';

  const exportAnchor = /(\nexport default (?:function|const) )/;
  if (!exportAnchor.test(dText)) {
    console.error('[v181] FATAL: discover EDIT A2 anchor (export default) missed.');
    process.exit(2);
  }
  dText = dText.replace(exportAnchor, '\n' + moduleVar + '$1');

  // Sanity
  const d = braceDelta(dText) - braceDelta(dRead.text);
  if (d !== 0) { console.error(`[v181] FATAL: discover brace delta ${d}.`); process.exit(3); }
  console.log('[v181] discover.tsx: throttle lifted to module scope (A1+A2)');
}

// ═════════════════════════════════════════════════════════════════════════
// PART B — player.tsx — 4 router.push → router.replace
// ═════════════════════════════════════════════════════════════════════════
const pRead = read(PLAYER);
let pText = pRead.text;

if (pText.indexOf('V181_BINGE_REPLACE') !== -1) {
  console.log('[v181] player.tsx: already patched, skipping');
} else {
  const edits = [
    {
      label: 'B1 auto binge fast-path /player',
      old: "            preResolveRef.current = null;\n" +
           "            router.push({ pathname: '/player', params: _params });",
      new: "            preResolveRef.current = null;\n" +
           "            /* V181_BINGE_REPLACE — replace instead of push so the old player\n" +
           "               unmounts atomically; eliminates the black-frame flash. */\n" +
           "            router.replace({ pathname: '/player', params: _params } as any);",
    },
    {
      label: 'B2 auto binge fallback /details',
      old: "            // Fallback (pre-resolve incomplete) — original autoplay flow.\n" +
           "            router.push({\n" +
           "              pathname: `/details/series/${nextEpisodeId}`,\n" +
           "              params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '', nextPoster: (nextEpisodePoster || poster || '') as string, nextBackdrop: (backdrop || '') as string },\n" +
           "            });",
      new: "            // V181_BINGE_REPLACE — replace, not push (same reason as B1).\n" +
           "            router.replace({\n" +
           "              pathname: `/details/series/${nextEpisodeId}`,\n" +
           "              params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '', nextPoster: (nextEpisodePoster || poster || '') as string, nextBackdrop: (backdrop || '') as string },\n" +
           "            } as any);",
    },
    {
      label: 'B3 manual binge fast-path /player',
      old: "      preResolveRef.current = null;\n" +
           "      router.push({ pathname: '/player', params: _paramsM });",
      new: "      preResolveRef.current = null;\n" +
           "      /* V181_BINGE_REPLACE — manual next-episode also uses replace. */\n" +
           "      router.replace({ pathname: '/player', params: _paramsM } as any);",
    },
    {
      label: 'B4 manual binge fallback /details',
      old: "      // Fallback (pre-resolve not ready) — original autoplay flow.\n" +
           "      router.push({\n" +
           "        pathname: `/details/series/${nextEpisodeId}`,\n" +
           "        params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '' },\n" +
           "      });",
      new: "      // V181_BINGE_REPLACE — same.\n" +
           "      router.replace({\n" +
           "        pathname: `/details/series/${nextEpisodeId}`,\n" +
           "        params: { autoPlay: 'true', nextTitle: nextEpisodeTitle || '' },\n" +
           "      } as any);",
    },
  ];

  for (const e of edits) {
    if (pText.indexOf(e.old) === -1) {
      console.error(`[v181] FATAL: player ${e.label} anchor missed.`);
      process.exit(2);
    }
    pText = pText.replace(e.old, e.new, 1);
    console.log(`[v181] player.tsx: ${e.label} → router.replace`);
  }

  const dB = braceDelta(pText) - braceDelta(pRead.text);
  if (dB !== 0) { console.error(`[v181] FATAL: player brace delta ${dB}.`); process.exit(3); }
}

// ═════════════════════════════════════════════════════════════════════════
// Write atomically — only if both validated
// ═════════════════════════════════════════════════════════════════════════
if (dText !== dRead.text) write(DISCOVER, dText, dRead.eol, dRead.raw);
if (pText !== pRead.text) write(PLAYER,   pText, pRead.eol, pRead.raw);

console.log('');
console.log('━'.repeat(60));
console.log(' NEXT STEPS');
console.log('━'.repeat(60));
console.log('  1) Rebuild the APK:');
console.log('       cd android && .\\gradlew assembleRelease');
console.log('  2) Install:');
console.log('       adb -s <serial> install -r android\\app\\build\\outputs\\apk\\release\\app-release.apk');
console.log('  3) Test:');
console.log('       a. Discover → click any poster → Details → Back → Discover');
console.log('          (should be instant — no JS freeze, no D-pad lag)');
console.log('       b. Play any episode → wait for credits → "Next Episode"');
console.log('          (should transition seamlessly — no black flash)');
console.log('━'.repeat(60));
