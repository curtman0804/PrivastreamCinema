/* eslint-disable */
// apply_patches_v19c.js — ContentCard.tsx: prefetch streams on poster focus
// Run from project root:   node apply_patches_v19c.js
//
// Hooks into the existing handleFocus in ContentCard. When a poster gets
// focus (D-pad on Firestick, hover on web), we wait 800ms (so flicking
// across rows doesn't fire dozens of fetches) and then call
// useContentStore.prefetchStreams(type, id). By the time the user clicks
// the poster, streams are already in memory cache.
//
// Requires V19-B (which adds prefetchStreams to the contentStore).

const fs = require('fs');
const path = require('path');

const CARD = path.join('frontend', 'src', 'components', 'ContentCard.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(CARD)) { bad('ContentCard.tsx not found at ' + CARD); process.exit(1); }

let src = fs.readFileSync(CARD, 'utf8');
const orig = src;
const bak = CARD + '.bak.v19c.' + Date.now();
fs.copyFileSync(CARD, bak);
info('backup → ' + bak);

// Normalize EOL to LF for matching, restore on save.
const _origHadCRLF = src.indexOf('\r\n') >= 0;
if (_origHadCRLF) { src = src.replace(/\r\n/g, '\n'); info('normalized CRLF → LF for matching (will restore on save)'); }

console.log('\n=== Patching ' + CARD + ' ===');

const MARKER = 'PATCH_V19C_FOCUS_PREFETCH';

if (src.includes(MARKER)) {
  ok('V19-C already applied — nothing to do');
  process.exit(0);
}

// =====================================================================
// PART 1: Add useContentStore import (alongside the existing api import)
// =====================================================================
{
  const importAnchor = "import { ContentItem, SearchResult, api } from '../api/client';";
  if (!src.includes(importAnchor)) {
    bad('could not find ContentItem/api import anchor in ContentCard');
  } else {
    if (src.includes("from '../store/contentStore'")) {
      ok('contentStore import already present');
    } else {
      const newImport = [
        "import { ContentItem, SearchResult, api } from '../api/client';",
        "import { useContentStore } from '../store/contentStore'; // " + MARKER,
      ].join('\n');
      src = src.replace(importAnchor, newImport);
      ok('added useContentStore import');
    }
  }
}

// =====================================================================
// PART 2: Wire up prefetch on focus (modify handleFocus + handleBlur)
// =====================================================================
{
  // Anchor on the existing handleFocus block. We replace the WHOLE pair
  // (handleFocus + handleBlur) with versions that schedule + cancel a
  // prefetch timer.
  const oldBlock = [
    "  const handleFocus = useCallback(() => {",
    "    setIsFocused(true);",
    "    onCardFocus?.();",
    "  }, [onCardFocus]);",
    "",
    "  const handleBlur = useCallback(() => {",
    "    setIsFocused(false);",
    "    onCardBlur?.();",
    "  }, [onCardBlur]);",
  ].join('\n');

  if (!src.includes(oldBlock)) {
    bad('could not find existing handleFocus/handleBlur block to wrap');
  } else {
    const newBlock = [
      "  // " + MARKER + " — schedule a stream prefetch ~800ms after focus so",
      "  // flicking rows on the D-pad doesn't fire dozens of network requests.",
      "  const _prefetchTimerRef = useRef<any>(null);",
      "",
      "  const handleFocus = useCallback(() => {",
      "    setIsFocused(true);",
      "    onCardFocus?.();",
      "    // Schedule prefetch",
      "    if (_prefetchTimerRef.current) clearTimeout(_prefetchTimerRef.current);",
      "    _prefetchTimerRef.current = setTimeout(() => {",
      "      _prefetchTimerRef.current = null;",
      "      try {",
      "        const _itemAny: any = item;",
      "        const _type: string | undefined = _itemAny?.type || (_itemAny?.imdb_id ? 'movie' : undefined);",
      "        const _id: string | undefined = _itemAny?.imdb_id || _itemAny?.id;",
      "        if (_type && _id) {",
      "          const _store: any = useContentStore.getState();",
      "          if (typeof _store.prefetchStreams === 'function') {",
      "            _store.prefetchStreams(_type, _id);",
      "          }",
      "        }",
      "      } catch { /* prefetch is best-effort */ }",
      "    }, 800);",
      "  }, [onCardFocus, item]);",
      "",
      "  const handleBlur = useCallback(() => {",
      "    setIsFocused(false);",
      "    onCardBlur?.();",
      "    if (_prefetchTimerRef.current) {",
      "      clearTimeout(_prefetchTimerRef.current);",
      "      _prefetchTimerRef.current = null;",
      "    }",
      "  }, [onCardBlur]);",
    ].join('\n');
    src = src.replace(oldBlock, newBlock);
    ok('wired prefetch into handleFocus + handleBlur');
  }
}

// Save
if (src !== orig && fail === 0) {
  const finalOut = _origHadCRLF ? src.replace(/\n/g, '\r\n') : src;
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
  console.log('\nV19-C done. Rebuild and test:');
  console.log('  ✓ Hover/D-pad on a poster for ~1s → streams pre-cached');
  console.log('  ✓ Click the poster → details page shows streams INSTANTLY');
  console.log('  ✓ Flicking quickly across posters does NOT fire 20 fetches');
  console.log('\nThis completes the V19 trio. App should now feel Stremio-snappy.');
}
