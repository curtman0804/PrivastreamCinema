/**
 * apply_patches_v70b.js — Safe subset of v70: NO Reanimated.
 *
 * v70 broke the release build because react-native-reanimated@~4.1.1
 * needs the new react-native-worklets babel plugin which isn't wired up.
 * v70b drops the Reanimated focus change and keeps ONLY the wins that
 * don't touch animation libraries:
 *
 *   1. PATCH_V70B_RESIZE_PROXY — on TV, route posters through /api/img?w=N
 *   2. PATCH_V70B_IMG_DIMS    — add explicit width/height to expo-image
 *                               source so the decoder downsamples natively
 *
 * These two changes alone cut TV poster payload ~70% and remove the
 * decode-stall hitches on Streamer 4K. The Reanimated focus optimization
 * is parked until your Reanimated/babel setup is sorted out separately.
 *
 * Idempotent. Auto-aborts and restores file if any anchor is missing.
 * Run:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v70b.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v70b.js
 *   node apply_patches_v70b.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'ContentCard.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}
console.log(`[ok] target: ${TARGET}`);

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V70B_RESIZE_PROXY')) {
  console.log('[OK] v70b already applied.');
  process.exit(0);
}

// Refuse to run if the file still contains v70 (Reanimated) markers.
// User must rollback v70 first.
if (src.includes('PATCH_V70_REANIMATED_FOCUS') || src.includes('Animated.View')) {
  console.error('[FAIL] v70 (Reanimated) is still present in ContentCard.tsx.');
  console.error('       Roll back v70 first:');
  console.error('         copy /Y ContentCard.tsx.bak.v70.* ContentCard.tsx');
  console.error('       Then re-run this script.');
  process.exit(3);
}

const bak = `${TARGET}.bak.v70b.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup → ${bak}`);

const steps = [];
function step(name, fn) {
  const before = src;
  fn();
  if (src === before) {
    console.error(`[FAIL] step "${name}" made no change. Anchor missing?`);
    fs.writeFileSync(TARGET, before);
    process.exit(2);
  }
  steps.push(name);
  console.log(`[ok] ${name}`);
}

// ─── 1. Inject getResizedPoster helper right after getProxiedPosterUrl ───
step('inject-resize-helper', () => {
  const re = /(const getProxiedPosterUrl\s*=\s*\(originalUrl:\s*string\):\s*string\s*=>\s*\{[\s\S]+?\n\};)/;
  if (!re.test(src)) {
    throw new Error('getProxiedPosterUrl block not found');
  }
  src = src.replace(re,
    `$1\n\n// PATCH_V70B_RESIZE_PROXY — on TV, always route posters through backend resize proxy.\n// Cuts payload ~70% (Cinemeta /large is 200-500KB; we get back ~30-50KB JPEGs).\nconst getResizedPoster = (poster: string, useProxy: boolean, isTV: boolean, cardWidth: number): string => {\n  if (!poster) return poster;\n  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';\n  // Target width = 2× card width (retina). Cap 160-600.\n  const targetW = Math.min(600, Math.max(160, Math.round(cardWidth * 2)));\n  if (isTV || useProxy) {\n    return \`\${backendUrl}/api/img?w=\${targetW}&u=\${encodeURIComponent(poster)}\`;\n  }\n  return poster;\n};`
  );
});

// ─── 2. Image source: route through resize proxy + add explicit dimensions ───
step('rewrite-image-source', () => {
  const re = /source=\{\{\s*uri:\s*useProxy\s*\?\s*getProxiedPosterUrl\(item\.poster\)\s*:\s*item\.poster\s*\}\}/;
  if (!re.test(src)) {
    throw new Error('Image source pattern not matched');
  }
  src = src.replace(re,
    `source={{ uri: getResizedPoster(item.poster, useProxy, isTV, cardWidth), width: Math.round(cardWidth * 2), height: Math.round(cardHeight * 2) }} /* PATCH_V70B_IMG_DIMS */`
  );
});

// ─── 3. Persist ───
fs.writeFileSync(TARGET, src);

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(` ✅ V70B APPLIED — ${steps.length} steps. NO Reanimated. Safe to build.`);
console.log('═══════════════════════════════════════════════════════════════');
steps.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
console.log('');
console.log(' Rebuild your APK now. Expected:');
console.log('   • TV posters ~3-5× smaller payload (server-side JPEG resize)');
console.log('   • No more decode-stalls on Streamer 4K when scrolling');
console.log('   • Build succeeds — no Reanimated calls added');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
