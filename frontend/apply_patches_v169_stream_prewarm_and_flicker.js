/*
 * apply_patches_v169_stream_prewarm_and_flicker.js
 *
 * V169 — Faster stream load + kill the count flicker.
 *
 * Two surgical frontend changes.  No backend changes (v168 + v168b already
 * cache hot data; v77b prewarm + v151 pre-resolve already cover the rest).
 *
 * ───────────────────────────────────────────────────────────────────
 *  (A) V169_FOCUS_STREAM_PREWARM     src/components/ContentCard.tsx
 * ───────────────────────────────────────────────────────────────────
 *  prefetchStreams() is already defined in contentStore (with a 30s
 *  pending-dedupe and memory+disk cache) but nothing in the app ever
 *  calls it.  Wire it up so when a movie poster receives D-pad focus
 *  (or hover on web) for ~500ms, the backend's /api/streams response
 *  is pre-fetched into both memory and AsyncStorage.  By the time the
 *  user actually clicks, fetchStreams hits the in-memory cache and
 *  the details screen renders streams instantly — no spinner.
 *
 *  Only movies prefetch (series root IDs have no useful streams; the
 *  v138 patch already prefetches the next episode separately).
 *
 * ───────────────────────────────────────────────────────────────────
 *  (B) V169_STREAM_COUNT_USES_SORTED   app/details/[type]/[id].tsx
 * ───────────────────────────────────────────────────────────────────
 *  The Play row + count uses raw `streams.length` while the FlatList
 *  below uses filtered `sortedStreams`.  That's why the counter
 *  flickers 2 → 75 → 8 — the v157/v161 filter shrinks 75 → 8 only
 *  for the list, leaving the counter still showing 75 for a frame.
 *  Swap the three `streams.length` callsites in the Streams section
 *  to `sortedStreams.length` so counter + list move together.
 *
 * Idempotent.  Re-runs are a no-op once V169_FOCUS_STREAM_PREWARM and
 * V169_STREAM_COUNT_USES_SORTED markers are present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v169_stream_prewarm_and_flicker.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const ID_PATH = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v169] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v169] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 1: ContentCard.tsx — focus-based stream prewarm for movies
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V169_FOCUS_STREAM_PREWARM') !== -1) {
    console.log('[v169] ContentCard.tsx: already patched (V169 marker present), skipping');
  } else {
    let changes = 0;

    // 1a) Add the contentStore import.  We use it as getState() (non-hook)
    //     to avoid coupling the card to a store subscription.
    const ccImportAnchor = "import { ContentItem, SearchResult, api } from '../api/client';";
    if (src.indexOf(ccImportAnchor) === -1) {
      console.error('[v169] FATAL: ContentCard.tsx — could not locate client import anchor.');
      process.exit(2);
    }
    src = src.replace(
      ccImportAnchor,
      ccImportAnchor +
        "\nimport { useContentStore as _v169UseContentStore /* V169_FOCUS_STREAM_PREWARM */ } from '../store/contentStore';"
    );
    changes++;

    // 1b) Add a focus-dwell timer ref + start/stop logic inside handleFocus/handleBlur.
    const oldFocus =
      '  const handleFocus = useCallback(() => {\n' +
      '    setIsFocused(true);\n' +
      '    onCardFocus?.();\n' +
      '  }, [onCardFocus]);\n' +
      '\n' +
      '  const handleBlur = useCallback(() => {\n' +
      '    setIsFocused(false);\n' +
      '    onCardBlur?.();\n' +
      '  }, [onCardBlur]);';

    const newFocus =
      '  /* V169_FOCUS_STREAM_PREWARM — dwell-timer ref so we only prefetch\n' +
      '     streams when the user actually lingers (>= 500ms) on a poster. */\n' +
      '  const _v169PrewarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);\n' +
      '\n' +
      '  const handleFocus = useCallback(() => {\n' +
      '    setIsFocused(true);\n' +
      '    onCardFocus?.();\n' +
      '    /* V169_FOCUS_STREAM_PREWARM — kick a 500ms dwell timer.  Only\n' +
      '       movies get streams prefetched (series root IDs have no usable\n' +
      '       streams; the v138 patch already prefetches the next episode). */\n' +
      '    if (_v169PrewarmTimerRef.current) {\n' +
      '      clearTimeout(_v169PrewarmTimerRef.current);\n' +
      '      _v169PrewarmTimerRef.current = null;\n' +
      '    }\n' +
      '    const _v169_type = (item as any)?.type;\n' +
      '    const _v169_cid = (item as any)?.imdb_id || (item as any)?.id;\n' +
      '    if (_v169_cid && _v169_type === \'movie\' && String(_v169_cid).startsWith(\'tt\')) {\n' +
      '      _v169PrewarmTimerRef.current = setTimeout(() => {\n' +
      '        try {\n' +
      '          const _v169_pf = _v169UseContentStore.getState().prefetchStreams;\n' +
      '          if (typeof _v169_pf === \'function\') _v169_pf(_v169_type, String(_v169_cid));\n' +
      '        } catch (_) { /* prefetch is best-effort */ }\n' +
      '      }, 500);\n' +
      '    }\n' +
      '  }, [onCardFocus, item]);\n' +
      '\n' +
      '  const handleBlur = useCallback(() => {\n' +
      '    setIsFocused(false);\n' +
      '    onCardBlur?.();\n' +
      '    /* V169_FOCUS_STREAM_PREWARM — abort the dwell timer if the user\n' +
      '       moved off before 500ms; nothing to do if the prefetch already fired. */\n' +
      '    if (_v169PrewarmTimerRef.current) {\n' +
      '      clearTimeout(_v169PrewarmTimerRef.current);\n' +
      '      _v169PrewarmTimerRef.current = null;\n' +
      '    }\n' +
      '  }, [onCardBlur]);';

    if (src.indexOf(oldFocus) === -1) {
      console.error('[v169] FATAL: ContentCard.tsx — could not locate handleFocus/handleBlur block to replace.');
      process.exit(3);
    }
    src = src.replace(oldFocus, newFocus);
    changes++;

    write(file, src);
    console.log(`[v169] ContentCard.tsx: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 2: app/details/[type]/[id].tsx — kill the counter flicker
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V169_STREAM_COUNT_USES_SORTED') !== -1) {
    console.log('[v169] [id].tsx: already patched (V169 marker present), skipping');
  } else {
    let changes = 0;

    // 2a) Play button + Stream count gate.
    const oldGate = '                {!isLoadingStreams && streams.length > 0 && (';
    const newGate = '                {/* V169_STREAM_COUNT_USES_SORTED — use filtered list for gating */}\n                {!isLoadingStreams && sortedStreams.length > 0 && (';
    if (src.indexOf(oldGate) === -1) {
      console.error('[v169] FATAL: [id].tsx — could not locate Play button gate.');
      process.exit(4);
    }
    src = src.replace(oldGate, newGate);
    changes++;

    // 2b) Stream count label.
    const oldLabel =
      '                  {isLoadingStreams ? (type === \'tv\' ? \'Verifying Live Streams...\' : \'Finding Streams...\') : `${streams.length} Stream${streams.length !== 1 ? \'s\' : \'\'}`}';
    const newLabel =
      '                  {/* V169_STREAM_COUNT_USES_SORTED — display filtered count to match list */}\n' +
      '                  {isLoadingStreams ? (type === \'tv\' ? \'Verifying Live Streams...\' : \'Finding Streams...\') : `${sortedStreams.length} Stream${sortedStreams.length !== 1 ? \'s\' : \'\'}`}';
    if (src.indexOf(oldLabel) === -1) {
      console.error('[v169] FATAL: [id].tsx — could not locate stream count label.');
      process.exit(5);
    }
    src = src.replace(oldLabel, newLabel);
    changes++;

    // 2c) "No streams" gate.
    const oldEmpty = '              ) : streams.length === 0 ? (';
    const newEmpty = '              /* V169_STREAM_COUNT_USES_SORTED — empty-state uses filtered list */\n              ) : sortedStreams.length === 0 ? (';
    if (src.indexOf(oldEmpty) === -1) {
      console.error('[v169] FATAL: [id].tsx — could not locate no-streams empty-state gate.');
      process.exit(6);
    }
    src = src.replace(oldEmpty, newEmpty);
    changes++;

    write(file, src);
    console.log(`[v169] [id].tsx: ${changes} change(s) applied`);
  }
}

console.log('[v169] DONE.  Rebuild your Expo app and sideload to test.');
