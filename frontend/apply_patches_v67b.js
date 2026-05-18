/**
 * apply_patches_v67b.js — Robust version of V67 ServiceRow fix.
 *
 * V67 found ContentCard OK but bailed on ServiceRow due to whitespace
 * mismatch. v67b uses fragment-level anchors instead of a big block,
 * so it tolerates any formatting variation.
 *
 * Idempotent. Run on Windows:
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl -o apply_patches_v67b.js https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v67b.js
 *   node apply_patches_v67b.js
 */
const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, 'src', 'components', 'ServiceRow.tsx');
if (!fs.existsSync(TARGET)) {
  console.error('[FAIL] not found:', TARGET);
  process.exit(1);
}
console.log(`[ok] target: ${TARGET}`);

let src = fs.readFileSync(TARGET, 'utf8');

if (src.includes('PATCH_V67_STABLE_CALLBACKS')) {
  console.log('[OK] v67/v67b already applied.');
  process.exit(0);
}

const bak = `${TARGET}.bak.v67b.${Date.now()}`;
fs.writeFileSync(bak, src);
console.log(`[ok] backup → ${bak}`);

// ─── 1. Replace inline `onPress={() => onItemPress(item)}` ───
const arrow1 = /onPress=\{\s*\(\)\s*=>\s*onItemPress\(item\)\s*\}/;
if (!arrow1.test(src)) {
  console.error('[FAIL] could not find onPress arrow');
  process.exit(1);
}
src = src.replace(arrow1, 'onPress={v67GetPress(item)}');
console.log('[ok] replaced onPress arrow');

// ─── 2. Replace inline `onCardFocus={() => handleCardFocus(index)}` ───
const arrow2 = /onCardFocus=\{\s*\(\)\s*=>\s*handleCardFocus\(index\)\s*\}/;
if (!arrow2.test(src)) {
  console.error('[FAIL] could not find onCardFocus arrow');
  process.exit(1);
}
src = src.replace(arrow2, 'onCardFocus={v67GetFocus(index)}');
console.log('[ok] replaced onCardFocus arrow');

// ─── 3. Inject v67Cache helpers right BEFORE `const renderItem = useCallback` ───
const renderItemAnchor = /(\n\s*)const renderItem\s*=\s*useCallback/;
const m = src.match(renderItemAnchor);
if (!m) {
  console.error('[FAIL] could not find renderItem useCallback declaration');
  process.exit(1);
}
const leadingNL = m[1];
const inject = `${leadingNL}// PATCH_V67_STABLE_CALLBACKS — per-index callback cache; restores React.memo on ContentCard${leadingNL}const v67Cache = useRef<{ press: Map<any, () => void>; focus: Map<number, () => void> }>({${leadingNL}  press: new Map(),${leadingNL}  focus: new Map(),${leadingNL}});${leadingNL}useEffect(() => {${leadingNL}  v67Cache.current.press.clear();${leadingNL}  v67Cache.current.focus.clear();${leadingNL}}, [onItemPress, handleCardFocus]);${leadingNL}const v67GetPress = (item: any) => {${leadingNL}  const key = item.id || item.imdb_id || item;${leadingNL}  let fn = v67Cache.current.press.get(key);${leadingNL}  if (!fn) { fn = () => onItemPress(item); v67Cache.current.press.set(key, fn); }${leadingNL}  return fn;${leadingNL}};${leadingNL}const v67GetFocus = (index: number) => {${leadingNL}  let fn = v67Cache.current.focus.get(index);${leadingNL}  if (!fn) { fn = () => handleCardFocus(index); v67Cache.current.focus.set(index, fn); }${leadingNL}  return fn;${leadingNL}};${leadingNL}`;

src = src.replace(renderItemAnchor, inject + m[0]);
console.log('[ok] injected v67Cache + v67GetPress + v67GetFocus helpers');

// ─── 4. Ensure useEffect + useRef are imported from React ───
src = src.replace(
  /import\s+React\s*,\s*\{([^}]+)\}\s*from\s*'react'\s*;/,
  (whole, inside) => {
    const items = inside.split(',').map(s => s.trim()).filter(Boolean);
    let changed = false;
    if (!items.includes('useEffect')) { items.push('useEffect'); changed = true; }
    if (!items.includes('useRef')) { items.push('useRef'); changed = true; }
    if (changed) console.log('[ok] added useEffect/useRef to react imports');
    return `import React, { ${items.join(', ')} } from 'react';`;
  }
);

fs.writeFileSync(TARGET, src);
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log(' V67B APPLIED — ServiceRow now uses stable per-index callbacks');
console.log('═══════════════════════════════════════════════════════════════');
console.log('');
console.log(' Combined with V67 ContentCard (transition={0}) which is already');
console.log(' applied, your Discover scroll should fly on Streamer 4K.');
console.log('');
console.log(' REBUILD APK and install on Streamer 4K.');
console.log(' Hold D-pad → should match Stremio speed.');
console.log('');
console.log(` ROLLBACK:  copy /Y "${bak}" "${TARGET}"`);
console.log('═══════════════════════════════════════════════════════════════');
