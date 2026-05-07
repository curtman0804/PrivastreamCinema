/**
 * Privastream Frontend Patch v3 — dedupe duplicate BackHandler import.
 *
 * Usage on Windows CMD (from the repo root):
 *   cd C:\Users\Curtm\PrivastreamCinema
 *   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v3.js -o apply_patches_v3.js
 *   node apply_patches_v3.js
 */

const fs = require('fs');
const path = require('path');

const REPO = process.cwd();
const DETAILS = path.join(REPO, 'frontend', 'app', 'details', '[type]', '[id].tsx');

if (!fs.existsSync(DETAILS)) {
  console.error('ERROR: cannot find', DETAILS);
  process.exit(1);
}

console.log('[v3] Reading details file...');
fs.copyFileSync(DETAILS, DETAILS + '.bak3');
let content = fs.readFileSync(DETAILS, 'utf-8');

const standaloneImport = "import { BackHandler } from 'react-native';";
const standaloneCount = (content.match(new RegExp(standaloneImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;

// Check if the multi-line import block also declares BackHandler.
// Pattern: `import {\n  ...\n  BackHandler,\n  ...\n} from 'react-native';`
const multilineHasBackHandler = /import\s*\{[\s\S]*?BackHandler[\s\S]*?\}\s*from\s+['"]react-native['"];/.test(
  content.replace(standaloneImport, '')  // strip standalone first so it doesn't double-count
);

console.log(`[v3] standalone "import { BackHandler }" lines: ${standaloneCount}`);
console.log(`[v3] BackHandler in multi-line react-native import: ${multilineHasBackHandler ? 'YES' : 'NO'}`);

if (multilineHasBackHandler && standaloneCount >= 1) {
  // Remove ALL standalone import lines — the multi-line block already covers BackHandler.
  const before = content.length;
  content = content
    .split('\n')
    .filter((l) => l.trim() !== standaloneImport)
    .join('\n');
  console.log(`[v3] Removed ${standaloneCount} duplicate standalone BackHandler import line(s) (${before - content.length} bytes saved)`);
} else if (!multilineHasBackHandler && standaloneCount === 0) {
  // Neither place has it — add a single standalone import.
  content = standaloneImport + '\n' + content;
  console.log('[v3] Added missing BackHandler standalone import');
} else if (multilineHasBackHandler && standaloneCount === 0) {
  console.log('[v3] OK — BackHandler is in the multi-line import already, no standalone needed');
} else if (!multilineHasBackHandler && standaloneCount > 1) {
  // Dedupe — keep one
  let seen = false;
  content = content
    .split('\n')
    .filter((l) => {
      if (l.trim() === standaloneImport) {
        if (seen) return false;
        seen = true;
      }
      return true;
    })
    .join('\n');
  console.log('[v3] Deduped multiple standalone BackHandler imports — kept 1');
} else {
  console.log('[v3] Already clean — nothing to do');
}

fs.writeFileSync(DETAILS, content);
console.log('[v3] Saved.\n');

// Verify
const finalStandalone = (content.match(new RegExp(standaloneImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
const finalMultiline = /import\s*\{[\s\S]*?BackHandler[\s\S]*?\}\s*from\s+['"]react-native['"];/.test(
  content.replace(standaloneImport, '')
);

console.log('[v3] After fix:');
console.log(`     standalone import lines: ${finalStandalone}`);
console.log(`     in multi-line block:     ${finalMultiline ? 'YES' : 'NO'}`);

const totalDeclarations = finalStandalone + (finalMultiline ? 1 : 0);
if (totalDeclarations === 1) {
  console.log('\n==> EXACTLY ONE BackHandler declaration. Try `cd frontend\\android && gradlew assembleRelease` again.');
} else if (totalDeclarations === 0) {
  console.log('\n==> WARNING: NO BackHandler declaration found. Manual fix needed.');
} else {
  console.log(`\n==> WARNING: ${totalDeclarations} declarations exist. Paste this output and I will fix.`);
}
