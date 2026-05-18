/**
 * apply_patches_v67.js — Kill the Android TV D-pad scrolling lag.
 *
 * Two root causes:
 *   1. ServiceRow's renderItem creates NEW arrow functions for onPress
 *      and onCardFocus on every render. This defeats React.memo on
 *      ContentCard — EVERY focus event re-renders every card in the row.
 *
 *   2. expo-image's default 200ms fade-in animation runs on every poster
 *      that becomes visible. When scrolling rapidly with the D-pad, dozens
 *      of fades happen per second → GPU pegged → lag.
 *
 * Fixes:
 *   • ServiceRow: build per-index stable callbacks cached in a Map.
 *     Each card gets a stable function reference; React.memo works again.
 *   • ContentCard: add transition={0} to expo-image — no fade animation.
 *
 * After this patch, holding D-pad on the Streamer 4K should fly through
 * posters at the same speed as Stremio.
 *
 * Idempotent. Safe to re-run.
 *
 * Run on Windows:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v67.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v67.js
 *   node apply_patches_v67.js
 */
const fs = require('fs');
const path = require('path');

function find(rels) {
  for (const r of rels) {
    const full = path.join(__dirname, r);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

const SERVICE_ROW = find([
  'src/components/ServiceRow.tsx',
  'frontend/src/components/ServiceRow.tsx',
]);
const CONTENT_CARD = find([
  'src/components/ContentCard.tsx',
  'frontend/src/components/ContentCard.tsx',
]);

if (!SERVICE_ROW || !CONTENT_CARD) {
  console.error('[FAIL] one or both files missing. Run from frontend/ folder.');
  console.error(`  ServiceRow.tsx: ${SERVICE_ROW || 'NOT FOUND'}`);
  console.error(`  ContentCard.tsx: ${CONTENT_CARD || 'NOT FOUND'}`);
  process.exit(1);
}

console.log(`[ok] ServiceRow → ${SERVICE_ROW}`);
console.log(`[ok] ContentCard → ${CONTENT_CARD}`);

// ════════════════════════════════════════════════════════════════════
// FIX 1 — ContentCard: disable expo-image fade-in
// ════════════════════════════════════════════════════════════════════
{
  let src = fs.readFileSync(CONTENT_CARD, 'utf8');
  if (src.includes('PATCH_V67_NO_FADE')) {
    console.log('\n[OK] ContentCard already patched.');
  } else {
    const bak = `${CONTENT_CARD}.bak.v67.${Date.now()}`;
    fs.writeFileSync(bak, src);
    console.log(`\n[ok] backup → ${bak}`);

    // Add transition={0} + priority right before cachePolicy="memory-disk"
    // Anchor: cachePolicy="memory-disk" (unique)
    const anchor = 'cachePolicy="memory-disk"';
    if (!src.includes(anchor)) {
      console.error('[FAIL] ContentCard: cachePolicy anchor not found.');
      process.exit(1);
    }
    // Insert new attrs just before it on a new line
    src = src.replace(
      anchor,
      `transition={0}             // PATCH_V67_NO_FADE — kill 200ms fade-in
              priority="normal"          // PATCH_V67_NO_FADE
              ${anchor}`
    );
    fs.writeFileSync(CONTENT_CARD, src);
    console.log('[ok] ContentCard: transition={0} + priority="normal" added to expo-image');
  }
}

// ════════════════════════════════════════════════════════════════════
// FIX 2 — ServiceRow: stable per-index callbacks
// ════════════════════════════════════════════════════════════════════
{
  let src = fs.readFileSync(SERVICE_ROW, 'utf8');
  if (src.includes('PATCH_V67_STABLE_CALLBACKS')) {
    console.log('\n[OK] ServiceRow already patched.');
  } else {
    const bak = `${SERVICE_ROW}.bak.v67.${Date.now()}`;
    fs.writeFileSync(bak, src);
    console.log(`\n[ok] backup → ${bak}`);

    // 2a) Inject the stable-callbacks helper right above renderItem
    const oldRender = `const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <ContentCard
      item={item}
      onPress={() => onItemPress(item)}
      onCardFocus={() => handleCardFocus(index)}
      onCardBlur={handleCardBlur}
      showTitle={true}
      hasTVPreferredFocus={isFirstRow && index === 0}
      isFirstInRow={index === 0}
      isLastInRow={index === itemCountRef.current - 1}
    />
  ), [onItemPress, handleCardFocus, handleCardBlur, isFirstRow]);`;

    const newRender = `// PATCH_V67_STABLE_CALLBACKS — per-index callback cache so React.memo on ContentCard actually works.
  // Without this, every focus event creates new arrow fns → all cards in the row re-render → D-pad lag.
  const v67Cache = useRef<{ press: Map<any, () => void>; focus: Map<number, () => void> }>({
    press: new Map(),
    focus: new Map(),
  });
  // Reset cache when handlers identity changes (rarely happens)
  useEffect(() => {
    v67Cache.current.press.clear();
    v67Cache.current.focus.clear();
  }, [onItemPress, handleCardFocus]);
  const v67GetPress = (item: ContentItem) => {
    const key = item.id || item.imdb_id || item;
    let fn = v67Cache.current.press.get(key);
    if (!fn) {
      fn = () => onItemPress(item);
      v67Cache.current.press.set(key, fn);
    }
    return fn;
  };
  const v67GetFocus = (index: number) => {
    let fn = v67Cache.current.focus.get(index);
    if (!fn) {
      fn = () => handleCardFocus(index);
      v67Cache.current.focus.set(index, fn);
    }
    return fn;
  };

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <ContentCard
      item={item}
      onPress={v67GetPress(item)}
      onCardFocus={v67GetFocus(index)}
      onCardBlur={handleCardBlur}
      showTitle={true}
      hasTVPreferredFocus={isFirstRow && index === 0}
      isFirstInRow={index === 0}
      isLastInRow={index === itemCountRef.current - 1}
    />
  ), [onItemPress, handleCardFocus, handleCardBlur, isFirstRow]);`;

    if (src.includes(oldRender)) {
      src = src.replace(oldRender, newRender);
      console.log('[ok] ServiceRow: stable callbacks injected (exact anchor)');
    } else {
      console.error('[FAIL] ServiceRow: renderItem anchor not found exactly.');
      console.error('       Looking for inline arrow patterns…');
      // Just patch the two arrow lines directly via narrower replacements
      const arrow1 = `onPress={() => onItemPress(item)}`;
      const arrow2 = `onCardFocus={() => handleCardFocus(index)}`;
      if (!src.includes(arrow1) || !src.includes(arrow2)) {
        console.error('[FAIL] inline arrow patterns also missing. Showing renderItem area:');
        const m = src.match(/renderItem[^]{0,800}/);
        if (m) console.error(m[0]);
        process.exit(1);
      }
      // Fallback: inject the cache + replace arrows
      // (gets complex — better to bail and ask for a fresh dump)
      console.error('[FAIL] need to anchor differently; please paste your ServiceRow.tsx lines 175-200');
      process.exit(1);
    }

    // 2b) Ensure useEffect is imported
    if (!/import\s+(?:.*\s)?\{[^}]*\buseEffect\b/.test(src)) {
      src = src.replace(
        /import\s+React\s*,\s*\{([^}]+)\}\s*from\s*'react'\s*;/,
        (m, inside) => {
          const items = inside.split(',').map(s => s.trim()).filter(Boolean);
          if (!items.includes('useEffect')) items.push('useEffect');
          if (!items.includes('useRef')) items.push('useRef');
          return `import React, { ${items.join(', ')} } from 'react';`;
        }
      );
      console.log('[ok] ServiceRow: ensured useEffect+useRef imports');
    }

    fs.writeFileSync(SERVICE_ROW, src);
  }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(' V67 APPLIED');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(' Two changes:');
console.log('   ✅ ContentCard: expo-image transition={0} (no fade-in)');
console.log('   ✅ ServiceRow:  stable per-index callbacks (React.memo works)');
console.log('');
console.log(' Rebuild APK and install on Streamer 4K.');
console.log(' Open Discover, hold the D-pad. Should fly through posters');
console.log(' at the same speed as Stremio — no lag.');
console.log('');
console.log(' If it\'s STILL laggy after V67, the next likely culprit is');
console.log(' poster image size (Cinemeta serves 500×750, we render at');
console.log(' ~180×270 → device decodes 4× more pixels than needed). V68');
console.log(' would proxy through your backend with width=200 resizing.');
console.log('');
console.log(' ROLLBACK:');
console.log('   copy /Y "src\\components\\ServiceRow.tsx.bak.v67.*" "src\\components\\ServiceRow.tsx"');
console.log('   copy /Y "src\\components\\ContentCard.tsx.bak.v67.*" "src\\components\\ContentCard.tsx"');
console.log('═══════════════════════════════════════════════════════════════');
