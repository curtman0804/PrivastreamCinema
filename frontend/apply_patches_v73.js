/**
 * apply_patches_v73.js — Patch C frontend: ServiceRow pagination reliability.
 *
 * Fixes "not all posters showing as you scroll a row":
 *
 *   1. PATCH_V73_RATE_LIMIT_500
 *      Drop the fetchMore rate-limit gate from 2000ms to 500ms. The
 *      original 2s gap meant fast horizontal D-pad scrolls outran the
 *      cooldown and items never loaded.
 *
 *   2. PATCH_V73_RETRY_ON_ERROR
 *      On fetch failure, hasMoreRef was set to false PERMANENTLY,
 *      killing pagination forever after a single network blip. Now
 *      we re-enable it after 5 seconds so a transient failure doesn't
 *      brick the row.
 *
 *   3. PATCH_V73_PREFETCH_EARLIER
 *      End-reached threshold 3 -> 1.5 viewports (still well ahead).
 *      Focus-driven prefetch trigger total-15 -> total-25 (start
 *      fetching when 25 items remain instead of 15) so users never
 *      hit the wall.
 *
 * Idempotent. Aborts cleanly if any anchor is missing.
 *
 * Run on Windows:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v73.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v73.js
 *   node apply_patches_v73.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'ServiceRow.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V73_RATE_LIMIT_500')) {
  console.log('[OK] v73 already applied.');
  process.exit(0);
}

const bak = `${TARGET}.bak.v73.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup -> ${bak}`);

const steps = [];
function step(name, fn) {
  const before = src;
  fn();
  if (src === before) {
    console.error(`[FAIL] step "${name}" made no change.`);
    fs.writeFileSync(TARGET, before);
    process.exit(2);
  }
  steps.push(name);
  console.log(`[ok] ${name}`);
}

// ─── 1. Drop the 2000ms rate-limit to 500ms ───
step('rate-limit-500', () => {
  const re = /if \(now - lastFetchTime\.current < 2000\) return;/;
  if (!re.test(src)) throw new Error('2000ms rate-limit not found');
  src = src.replace(re,
    `if (now - lastFetchTime.current < 500) return; // PATCH_V73_RATE_LIMIT_500`
  );
});

// ─── 2. Replace the catch block so errors don't permanently disable pagination ───
step('retry-on-error', () => {
  const re = /\} catch \{\s*hasMoreRef\.current = false;\s*\} finally \{\s*isFetchingRef\.current = false;\s*\}/;
  if (!re.test(src)) throw new Error('catch/finally block not found');
  src = src.replace(re,
`} catch {
        // PATCH_V73_RETRY_ON_ERROR — a transient failure should not kill
        // pagination forever. Re-arm hasMore after 5s so the next focus
        // or end-reached event can retry.
        setTimeout(() => { hasMoreRef.current = true; }, 5000);
      } finally {
        isFetchingRef.current = false;
      }`
  );
});

// ─── 3. Lower onEndReachedThreshold to 1.5 ───
step('end-threshold-1.5', () => {
  const re = /onEndReachedThreshold=\{3\}/;
  if (!re.test(src)) throw new Error('onEndReachedThreshold={3} not found');
  src = src.replace(re,
    `onEndReachedThreshold={1.5} /* PATCH_V73_PREFETCH_EARLIER */`
  );
});

// ─── 4. Lower the focus-driven prefetch trigger (total - 15 -> total - 25) ───
step('focus-prefetch-earlier', () => {
  const re = /index >=\s*totalRef\.current - 15 &&\s*hasMoreRef\.current/;
  if (!re.test(src)) throw new Error('focus-prefetch trigger not found');
  src = src.replace(re,
    `index >= totalRef.current - 25 && hasMoreRef.current /* PATCH_V73_PREFETCH_EARLIER */`
  );
});

fs.writeFileSync(TARGET, src);

console.log('');
console.log('===================================================================');
console.log(` V73 APPLIED — ${steps.length} pagination tweaks.`);
console.log('===================================================================');
console.log(' Expected after rebuild:');
console.log('   - Fast D-pad scroll through a row -> next batch arrives quickly');
console.log('   - Transient network blips no longer kill the row permanently');
console.log('   - Prefetch starts 25 items before end (was 15)');
console.log('   - FlashList prefetch fires 1.5 viewports from end (was 3)');
console.log('');
console.log(' Backend v68c is independent — apply it too for the porn addons.');
console.log('');
console.log(' ROLLBACK:');
console.log(`   copy /Y "${bak}" "${TARGET}"`);
console.log('');
