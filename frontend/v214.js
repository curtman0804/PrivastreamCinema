// =============================================================================
// PATCH v214 — Details screen ScrollView bottom-stop
//
// Same fix as v213 but for app/details/[type]/[id].tsx.  Adds three props
// to the FIRST <ScrollView ...> in the file IF they aren't already set:
//   • contentContainerStyle={{ paddingBottom: 24 }}
//   • overScrollMode="never"
//   • bounces={false}
//
// Safe even if the regex match is ambiguous: the script aborts with a
// clear message instead of corrupting the file.  Pure additive — no
// existing prop is rewritten.
//
// Run:
//   cd C:\Users\Curtm\PrivastreamCinema\frontend
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v214_details_bottom_stop.js -o v214.js
//   node v214.js
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const F = path.join(ROOT, 'app/details/[type]/[id].tsx');

if (!fs.existsSync(F)) {
  console.log('[ERR] file not found: ' + F);
  console.log('       (If your details file lives somewhere else, tell the agent and');
  console.log('        we will adjust the path.)');
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const before = raw;
const usesCRLF = /\r\n/.test(raw);
const normalize = (s) => s.replace(/\r\n/g, '\n');
const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
let work = normalize(raw);

if (work.includes('// v214 details bottom-stop')) {
  console.log('[noop] v214 already applied.'); process.exit(0);
}

// Find the FIRST <ScrollView ...> opening tag.  We use a tolerant match
// that captures the tag through its closing `>`.
const scrollRe = /<ScrollView([\s\S]*?)>/;
const match = scrollRe.exec(work);
if (!match) {
  console.log('[WARN] No <ScrollView> found in details file.  Nothing to do.');
  console.log('       (The details screen may use a different container — tell the');
  console.log('        agent and we will write a targeted patch.)');
  process.exit(0);
}

const fullTag = match[0];
const attrs = match[1] || '';

// Defensive: bail if there are MULTIPLE <ScrollView> in the file and we
// can't be sure we're touching the right one.
const scrollCount = (work.match(/<ScrollView[\s>]/g) || []).length;
if (scrollCount > 1) {
  console.log('[ERR] Found ' + scrollCount + ' <ScrollView> tags in the details file.');
  console.log('      Aborting blind patch — please upload the file so I can target');
  console.log('      the right one surgically.');
  process.exit(1);
}

// Build the new opening tag, only adding props that aren't already present.
const hasCCS = /\bcontentContainerStyle\s*=/.test(attrs);
const hasOSM = /\boverScrollMode\s*=/.test(attrs);
const hasBnc = /\bbounces\s*=/.test(attrs);
const hasV214 = /v214 details bottom-stop/.test(attrs);
if (hasCCS && hasOSM && hasBnc) {
  console.log('[noop] ScrollView already has all three props.'); process.exit(0);
}

const addLines = [];
addLines.push('          // v214 details bottom-stop');
if (!hasCCS) addLines.push('          contentContainerStyle={{ paddingBottom: 24 }}');
if (!hasOSM) addLines.push('          overScrollMode="never"');
if (!hasBnc) addLines.push('          bounces={false}');
const additions = '\n' + addLines.join('\n');

// Inject right before the closing > of the opening tag.  Preserve any
// existing trailing newline.
const newTag = '<ScrollView' + attrs.replace(/\s*$/, '') + additions + '\n        >';
work = work.replace(fullTag, newTag);

if (work === normalize(before)) {
  console.log('[noop] nothing changed.'); process.exit(0);
}

fs.writeFileSync(F + '.bak_v214', before, 'utf8');
fs.writeFileSync(F, denormalize(work), 'utf8');
console.log('[ok]   app/details/[type]/[id].tsx patched');
console.log('       added: ' + addLines.slice(1).join(', '));
console.log('       backup at app/details/[type]/[id].tsx.bak_v214');
console.log('');
console.log('Rebuild APK + sideload.  Expected:');
console.log('  • Details page no longer over-scrolls past the bottom row.');
console.log('  • DOWN press on last section does nothing instead of revealing void.');
console.log('');
console.log('Rollback:');
console.log('  copy /Y "app\\details\\[type]\\[id].tsx.bak_v214" "app\\details\\[type]\\[id].tsx"');
