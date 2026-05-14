/* eslint-disable */
// apply_patches_v25.js — focus-triggered stream prefetch (defensive)
// Run from project root:   node apply_patches_v25.js
//
// Two files, both purely additive.
//
// 1. frontend/src/store/contentStore.ts:
//    - Add `prefetchStreams: (type, id) => Promise<void>` to interface
//    - Add implementation that ONLY populates cache (memory + disk),
//      never touches visible streams[] state. Concurrency-limited (max 3).
//      Skips entirely if memory OR disk cache already has the entry.
//
// 2. frontend/src/components/ContentCard.tsx:
//    - Add useContentStore import
//    - Add a NEW useEffect that watches isFocused. After 1500ms of focus,
//      fires prefetchStreams. Cancelled on blur or component unmount.
//      The existing handleFocus/handleBlur are 100% untouched.

const fs = require('fs');
const path = require('path');

const STORE = path.join('frontend', 'src', 'store', 'contentStore.ts');
const CARD  = path.join('frontend', 'src', 'components', 'ContentCard.tsx');
let pass = 0, fail = 0;
const ok  = (m) => { pass++; console.log('  [OK]   ' + m); };
const bad = (m) => { fail++; console.log('  [FAIL] ' + m); };
const info = (m) => console.log('  [info] ' + m);

if (!fs.existsSync(STORE)) { bad('contentStore.ts not found'); process.exit(1); }
if (!fs.existsSync(CARD))  { bad('ContentCard.tsx not found'); process.exit(1); }

// =====================================================================
// FILE 1: contentStore.ts — add prefetchStreams (additive)
// =====================================================================
{
  let src = fs.readFileSync(STORE, 'utf8');
  const orig = src;
  const bak = STORE + '.bak.v25.' + Date.now();
  fs.copyFileSync(STORE, bak);
  info('backup → ' + bak);

  const EOL = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  console.log('\n=== Patching ' + STORE + ' ===');

  if (src.includes('PATCH_V25_PREFETCH') || src.includes('prefetchStreams')) {
    ok('prefetchStreams already in contentStore — skipping');
  } else {
    // 1a. Interface line — insert prefetchStreams declaration before addToLibrary
    {
      const anchor = "  addToLibrary: (item: ContentItem) => Promise<void>;";
      const fallback = "  fetchStreams: (type: string, id: string) => Promise<Stream[]>;";
      let inserted = false;
      if (src.includes(anchor)) {
        const replacement = "  prefetchStreams: (type: string, id: string) => Promise<void>; // PATCH_V25_PREFETCH" + EOL + anchor;
        src = src.replace(anchor, replacement);
        ok('added prefetchStreams to ContentState interface (before addToLibrary)');
        inserted = true;
      } else if (src.includes(fallback)) {
        const replacement = fallback + EOL + "  prefetchStreams: (type: string, id: string) => Promise<void>; // PATCH_V25_PREFETCH";
        src = src.replace(fallback, replacement);
        ok('added prefetchStreams to ContentState interface (after fetchStreams)');
        inserted = true;
      }
      if (!inserted) bad('could not find interface anchor for prefetchStreams declaration');
    }

    // 1b. Implementation — insert prefetchStreams BEFORE addToLibrary
    {
      const anchor = "  addToLibrary: async (item: ContentItem) => {";
      if (!src.includes(anchor)) {
        bad('could not find `addToLibrary: async (item: ContentItem) => {` anchor');
      } else {
        const impl = [
          "  // PATCH_V25_PREFETCH — best-effort cache warmer for poster focus.",
          "  // Skips if already cached (memory or disk). Caps concurrent fetches at 3.",
          "  // Never touches visible streams[] state — purely populates the caches.",
          "  prefetchStreams: async (type: string, id: string) => {",
          "    const cacheKey = `${type}/${id}`;",
          "    if (getStreamsCache(cacheKey)) return;",
          "    const _g: any = (globalThis as any);",
          "    if (!_g.__v25Prefetch) _g.__v25Prefetch = { inFlight: new Set<string>(), max: 3 };",
          "    const pf = _g.__v25Prefetch;",
          "    if (pf.inFlight.has(cacheKey)) return;",
          "    if (pf.inFlight.size >= pf.max) return; // back off when too many in flight",
          "    pf.inFlight.add(cacheKey);",
          "    try {",
          "      // Try disk first to avoid an unnecessary network round-trip",
          "      try {",
          "        const disk = (typeof loadStreamsFromDisk === 'function') ? await loadStreamsFromDisk(cacheKey) : null;",
          "        if (disk && disk.length > 0) { setStreamsCache(cacheKey, disk); return; }",
          "      } catch { /* disk lookup is best-effort */ }",
          "      const result = await api.addons.getAllStreams(type, id);",
          "      const allStreams = (result && result.streams) || [];",
          "      if (allStreams.length > 0) {",
          "        setStreamsCache(cacheKey, allStreams);",
          "        try { if (typeof saveStreamsToDisk === 'function') saveStreamsToDisk(cacheKey, allStreams); } catch {}",
          "      }",
          "    } catch { /* prefetch is best-effort */ }",
          "    finally { pf.inFlight.delete(cacheKey); }",
          "  },",
          "",
          "  addToLibrary: async (item: ContentItem) => {",
        ].join(EOL);
        src = src.replace(anchor, impl);
        ok('inserted prefetchStreams implementation before addToLibrary');
      }
    }

    if (src !== orig && fail === 0) {
      fs.writeFileSync(STORE, src, 'utf8');
      ok('saved ' + STORE);
    } else if (fail > 0) {
      info('contentStore failures — file NOT saved (original preserved)');
    }
  }
}

// =====================================================================
// FILE 2: ContentCard.tsx — focus-triggered prefetch useEffect (additive)
// =====================================================================
{
  let src = fs.readFileSync(CARD, 'utf8');
  const orig = src;
  const bak = CARD + '.bak.v25.' + Date.now();
  fs.copyFileSync(CARD, bak);
  info('\nbackup → ' + bak);

  const EOL = src.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  // Normalize for matching
  const _hadCRLF = EOL === '\r\n';
  if (_hadCRLF) src = src.replace(/\r\n/g, '\n');

  console.log('\n=== Patching ' + CARD + ' ===');
  const MARKER = 'PATCH_V25_FOCUS_PREFETCH';

  if (src.includes(MARKER)) {
    ok('focus prefetch effect already in ContentCard — skipping');
  } else {
    // 2a. Add useContentStore import (idempotent)
    {
      if (src.includes("from '../store/contentStore'") || src.includes('from "../store/contentStore"')) {
        ok('contentStore import already present');
      } else {
        const anchor = "import { ContentItem, SearchResult, api } from '../api/client';";
        if (!src.includes(anchor)) {
          bad('could not find existing api import line in ContentCard');
        } else {
          const replacement = anchor + "\nimport { useContentStore } from '../store/contentStore'; // " + MARKER;
          src = src.replace(anchor, replacement);
          ok('added useContentStore import');
        }
      }
    }

    // 2b. Insert useEffect that prefetches on focus (additive — no existing handler touched)
    {
      // Anchor on the existing handleBlur callback definition. We insert the
      // useEffect immediately AFTER it. Anchor is single-line and unique.
      const anchor = "  }, [onCardBlur]);";
      const occurrences = src.split(anchor).length - 1;
      if (occurrences === 0) {
        bad('could not find handleBlur callback close anchor');
      } else if (occurrences > 1) {
        bad('handleBlur close anchor matches ' + occurrences + ' times — refusing ambiguous patch');
      } else {
        const insertion = [
          "  }, [onCardBlur]);",
          "",
          "  // " + MARKER + " — when this poster has been focused for ~1.5s, prefetch its",
          "  // streams in the background so clicking the poster feels instant. Cancels",
          "  // automatically on blur or unmount. Backs off if 3+ prefetches are in flight.",
          "  React.useEffect(() => {",
          "    if (!isFocused) return;",
          "    const t = setTimeout(() => {",
          "      try {",
          "        const a: any = item;",
          "        const _type: string | undefined = a?.type || (a?.imdb_id ? 'movie' : undefined);",
          "        const _id: string | undefined = a?.imdb_id || a?.id;",
          "        if (_type && _id) {",
          "          const store: any = useContentStore.getState();",
          "          if (typeof store.prefetchStreams === 'function') store.prefetchStreams(_type, _id);",
          "        }",
          "      } catch { /* prefetch is best-effort */ }",
          "    }, 1500);",
          "    return () => clearTimeout(t);",
          "  }, [isFocused, item]);",
        ].join('\n');
        src = src.replace(anchor, insertion);
        ok('inserted focus prefetch useEffect after handleBlur');
      }
    }

    if (src !== orig && fail === 0) {
      const finalOut = _hadCRLF ? src.replace(/\n/g, '\r\n') : src;
      fs.writeFileSync(CARD, finalOut, 'utf8');
      ok('saved ' + CARD);
    } else if (fail > 0) {
      info('ContentCard failures — file NOT saved (original preserved)');
    }
  }
}

console.log('\n========================================');
console.log('  ' + pass + ' passed   ' + fail + ' failed');
console.log('========================================');

if (fail > 0) {
  console.log('\nFailed. Originals safe in their .bak.v25.* files.');
  process.exit(1);
} else {
  console.log('\nV25 done. Rebuild and test:');
  console.log('  ✓ D-pad onto a poster, wait ~1.5s → click → details opens with streams already loaded');
  console.log('  ✓ Flicking through posters quickly does NOT fire 20 fetches (debounced + capped)');
  console.log('  ✓ The visible streams state on the current screen is never disturbed by prefetch');
  console.log('\nIf builds + works, we move on. Tell me what feels off next.');
}
