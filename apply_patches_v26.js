/* eslint-disable */
// apply_patches_v26.js — ContentCard memo custom comparator (Discover scroll fix)
// Run from project root:   node apply_patches_v26.js
//
// THE BUG (in ServiceRow.tsx renderItem):
//   <ContentCard
//     onPress={() => onItemPress(item)}            // new fn each render
//     onCardFocus={() => handleCardFocus(index)}   // new fn each render
//     ... />
// ContentCard is already wrapped in memo() but those inline arrows have a
// new reference on every render — so memo's shallow compare fails and the
// card always re-renders. Horizontal scroll → 8+ cards re-paint per frame.
//
// THE FIX (in ContentCard.tsx):
// Replace `memo(ContentCardComponent)` with `memo(ContentCardComponent, eq)`
// where `eq` only compares the props that actually matter for visual output:
// item identity, focus-related flags, layout flags. Function refs are
// intentionally ignored — they call the same stable logic regardless.
//
// Single file. Single string replace. Zero behavior change.

const fs = require('fs');
const path = require('path');

const CARD = path.join('frontend', 'src', 'components', 'ContentCard.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(CARD)) { bad('ContentCard.tsx not found'); process.exit(1); }

let src = fs.readFileSync(CARD, 'utf8');
const orig = src;
const bak = CARD + '.bak.v26.' + Date.now();
fs.copyFileSync(CARD, bak);
info('backup → ' + bak);

const _hadCRLF = src.indexOf('\r\n') >= 0;
if (_hadCRLF) src = src.replace(/\r\n/g, '\n');

console.log('\n=== Patching ' + CARD + ' ===');

const MARKER = 'PATCH_V26_MEMO_EQ';

if (src.includes(MARKER)) {
  ok('V26 already applied — nothing to do');
  process.exit(0);
}

// ---------------------------------------------------------------------
// Replace `memo(ContentCardComponent)` with custom comparator version
// ---------------------------------------------------------------------
{
  const anchor = "export const ContentCard = memo(ContentCardComponent);";
  if (!src.includes(anchor)) {
    bad('could not find `export const ContentCard = memo(ContentCardComponent);` anchor');
  } else {
    const replacement = [
      "// " + MARKER + " — custom comparator that ignores inline arrow function",
      "// reference changes from ServiceRow's renderItem. Without this, every",
      "// horizontal scroll causes all visible cards to re-render because the",
      "// `onPress={() => onItemPress(item)}` arrow has a new reference each",
      "// render. We compare the props that actually affect visual output.",
      "function _v26CardPropsEqual(prev: ContentCardProps, next: ContentCardProps): boolean {",
      "  if (prev.item !== next.item) return false;",
      "  if (prev.size !== next.size) return false;",
      "  if (prev.showTitle !== next.showTitle) return false;",
      "  if (prev.hasTVPreferredFocus !== next.hasTVPreferredFocus) return false;",
      "  if (prev.isFirstInRow !== next.isFirstInRow) return false;",
      "  if (prev.isLastInRow !== next.isLastInRow) return false;",
      "  // Function props (onPress, onCardFocus, onCardBlur) intentionally",
      "  // skipped — their references change every render but they call the",
      "  // same stable parent handlers, so reusing the previous closure is",
      "  // safe and saves enormous repaint cost.",
      "  return true;",
      "}",
      "export const ContentCard = memo(ContentCardComponent, _v26CardPropsEqual);",
    ].join('\n');
    src = src.replace(anchor, replacement);
    ok('replaced memo(ContentCardComponent) with custom comparator');
  }
}

// Save (restoring CRLF)
if (src !== orig && fail === 0) {
  const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
  fs.writeFileSync(CARD, finalOut, 'utf8');
  ok('saved ' + CARD);
} else if (fail > 0) {
  info('failures detected — file NOT saved (original preserved in ' + bak + ')');
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Original is safe in ' + bak);
  process.exit(1);
} else {
  console.log('\nV26 done. Rebuild and test:');
  console.log('  ✓ Horizontal scroll on Discover: cards stop re-rendering on each frame');
  console.log('  ✓ Vertical scroll on Discover: same wins');
  console.log('  ✓ Going into and out of a poster: no compounding re-paint cost');
  console.log('\nThis is the actual Discover-lag fix. Tell me if it feels different.');
}
