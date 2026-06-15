// =============================================================================
// PATCH v214b — Details screen bottom-stop (targeted to outer ScrollView only)
//
// The outer ScrollView already has paddingBottom: 40 via its
// `scrollContentContainer` style, but Android TV happily bounces past it.
// Adding overScrollMode="never" + bounces={false} stops that.
//
// The inner horizontal ScrollView at line ~2033 (cast/similar carousel) is
// NOT touched.
//
// CRLF-safe. Idempotent.
//
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v214b_details_bounded.js -o v214b.js
//   node v214b.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const F = path.join(process.cwd(), 'app/details/[type]/[id].tsx');
if (!fs.existsSync(F)) { console.log('[ERR] details file not found'); process.exit(1); }

let raw = fs.readFileSync(F, 'utf8');
const before = raw;
const usesCRLF = /\r\n/.test(raw);
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
let work = normalize(raw);

if (work.includes('// v214b details bounded')) {
  console.log('[noop] already applied.'); process.exit(0);
}

// Target the outer ScrollView — the one that uses `scrollContent` style.
const old = `        <ScrollView 
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentContainer}
        >`;

const _new = `        <ScrollView
          style={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContentContainer}
          // v214b details bounded — stop the Android TV over-scroll past
          // the bottom padding so DOWN at the last section does nothing
          // instead of revealing a blank void (which confused focus search).
          overScrollMode="never"
          bounces={false}
        >`;

if (!work.includes(old)) {
  console.log('[ERR] outer ScrollView block did not match exact baseline. Aborting.');
  process.exit(1);
}
work = work.replace(old, _new);

if (work === normalize(before)) { console.log('[noop] nothing changed.'); process.exit(0); }

fs.writeFileSync(F + '.bak_v214b', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');
console.log('[ok]   app/details/[type]/[id].tsx patched');
console.log('       backup at app/details/[type]/[id].tsx.bak_v214b');
console.log('');
console.log('Rebuild APK + sideload.  Expected:');
console.log('  • Details screen no longer over-scrolls past the bottom row.');
console.log('  • Last section sits flush with the bottom padding.');
console.log('  • DOWN at the bottom does nothing (no more void / focus stalls).');
console.log('');
console.log('Rollback:');
console.log('  copy /Y "app\\details\\[type]\\[id].tsx.bak_v214b" "app\\details\\[type]\\[id].tsx"');
