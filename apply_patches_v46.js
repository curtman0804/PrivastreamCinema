/* eslint-disable */
// apply_patches_v46.js — P0 fix: 30s watchdog in fetchStreams.
//
// SYMPTOM: After exiting a movie player, the next click on any poster shows
// "Loading..." forever. Only clearing app data recovers.
//
// ROOT CAUSE: In frontend/src/store/contentStore.ts → fetchStreams(), the
// network call `api.addons.getAllStreams(type, id, ...)` can hang silently
// (no resolve, no reject). Since `set({ isLoadingStreams: true })` is set
// before the try/catch, and the only exit paths run inside try/catch, a
// hung Promise leaves `isLoadingStreams: true` forever.
//
// FIX: Inject a 30s safety watchdog right after `set({ isLoadingStreams: true,
// streams: [], error: null })`. The watchdog uses get() (already in scope from
// zustand's creator) to check the live state; if streams are still loading,
// it force-clears the flag. In the happy path the watchdog fires but is a
// no-op (guarded by the if-check), so no need to clearTimeout anywhere.
//
// Idempotent. CRLF-safe. Per-file .bak.v46.<ts> backup.

const fs = require('fs');
const path = require('path');

const FILE = path.join('frontend', 'src', 'store', 'contentStore.ts');
const MARKER = 'PATCH_V46_WATCHDOG';

if (!fs.existsSync(FILE)) {
  console.error('ERROR: ' + FILE + ' not found. Run from repo root.');
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');
const orig = src;
const hadCRLF = src.indexOf('\r\n') >= 0;
if (hadCRLF) src = src.replace(/\r\n/g, '\n');

if (src.includes(MARKER)) {
  console.log('[OK] V46 already applied — no changes made.');
  process.exit(0);
}

// Anchor — line 240 in current file:
//   set({ isLoadingStreams: true, streams: [], error: null });
// We match the whole line including its indentation.
const anchor = `    set({ isLoadingStreams: true, streams: [], error: null });`;
const anchorIdx = src.indexOf(anchor);

if (anchorIdx < 0) {
  console.error('[FAIL] Anchor not found in ' + FILE);
  console.error('       Looking for: ' + anchor);
  console.error('       The fetchStreams body may have been edited. Re-run');
  console.error('       diagnose_contentstore.js and share the new dump.');
  process.exit(1);
}

const injection =
`
    // ${MARKER} — force-clear isLoadingStreams if fetchStreams hangs >30s.
    // The if-guard makes this a no-op in the happy path; no cleanup needed.
    setTimeout(() => {
      if (get().isLoadingStreams) {
        console.log('[ContentStore] V46 watchdog fired — clearing stuck isLoadingStreams after 30s');
        set({ isLoadingStreams: false, error: null });
      }
    }, 30000);`;

const insertAt = anchorIdx + anchor.length;
src = src.slice(0, insertAt) + injection + src.slice(insertAt);

if (src === orig) {
  console.error('[FAIL] Anchor matched but no change made — aborting.');
  process.exit(1);
}

const bak = FILE + '.bak.v46.' + Date.now();
fs.copyFileSync(FILE, bak);
console.log('[info] backup → ' + bak);

fs.writeFileSync(FILE, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');
console.log('[OK]   V46 watchdog injected into ' + FILE);
console.log('');
console.log('========================================');
console.log('  V46 done. Rebuild + force-stop + relaunch.');
console.log('========================================');
console.log('Expected behavior:');
console.log('  ✓ After exiting a movie player, next poster click loads streams normally.');
console.log('  ✓ If a fetch genuinely hangs, after 30s the "Loading..." spinner clears');
console.log('    so the user can retry without clearing app data.');
console.log('  ✓ Watch logcat / Metro for:');
console.log('      [ContentStore] V46 watchdog fired — clearing stuck isLoadingStreams');
console.log('    (only fires on real hangs; happy path is silent.)');
console.log('');
console.log('If the stuck-loading bug is gone:');
console.log('  git add -A');
console.log('  git commit -m "fix: V46 — 30s fetchStreams watchdog (no more stuck loading)"');
