/*
 * apply_patches_v173_tv_longpress_and_watched_on_exit.js
 *
 * V173 — Three targeted fixes:
 *
 *   (A) V173_TV_LONGPRESS_REGISTRY       ContentCard.tsx
 *       Pressable.onLongPress fires unreliably on Google TV /
 *       Firestick OK button.  Add a single module-level
 *       DeviceEventEmitter listener for 'onTVKeyEvent' / 'longSelect'
 *       that dispatches to whichever card is currently focused.
 *
 *   (B) V173_TV_LONGPRESS_EPISODE        app/details/[type]/[id].tsx
 *       EpisodeCard already wires onLongPress={isWatched ? onMarkUnwatched
 *       : undefined} but that's TouchableOpacity.onLongPress -- same
 *       unreliability.  Reuse the ContentCard registry: in EpisodeCard
 *       onFocus/onBlur register/clear the mark-unwatched callback.
 *
 *   (C) V173_FORCE_WATCHED_ON_EXIT       player.tsx
 *       privastream_watched is only written inside the 5s-throttled
 *       saveProgress tick.  If the user fast-forwards past 90% and
 *       backs out before the next tick, the mark never lands.  Add the
 *       same write to the unmount cleanup so backing out always seals
 *       the watched state.
 *
 * Idempotent.  Re-runs are a no-op once V173 markers are present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v173_tv_longpress_and_watched_on_exit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH     = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const ID_PATH     = path.join(ROOT, 'app', 'details', '[type]', '[id].tsx');
const PLAYER_PATH = path.join(ROOT, 'app', 'player.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v173] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v173] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 1: ContentCard.tsx -- module-level TV longSelect dispatcher + per-card
//           focus registration.
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V173_TV_LONGPRESS_REGISTRY') !== -1) {
    console.log('[v173] ContentCard.tsx: already patched (V173 marker present), skipping');
  } else {
    let changes = 0;

    // 1a) Inject the registry + listener immediately after the V172 exports.
    const anchor = 'export async function v172UnmarkWatched';
    if (src.indexOf(anchor) === -1) {
      console.error('[v173] FATAL: ContentCard.tsx — v172 marker not found.  Apply v172 first.');
      process.exit(2);
    }
    // Splice AFTER the v172UnmarkWatched function's closing brace by hooking
    // at the next ContentCardComponent header.
    const headerAnchor = 'const ContentCardComponent';
    if (src.indexOf(headerAnchor) === -1) {
      console.error('[v173] FATAL: ContentCard.tsx — could not locate ContentCardComponent header.');
      process.exit(3);
    }
    const registry =
      '/* ─────────────────────────────────────────────────────────────────────────\n' +
      '   V173_TV_LONGPRESS_REGISTRY — Pressable.onLongPress is unreliable on\n' +
      '   Google TV / Firestick OK buttons.  Maintain a single global slot for\n' +
      '   the currently-focused card\'s long-press handler and dispatch the\n' +
      '   native \'longSelect\' TV event into it. */\n' +
      'let _v173FocusedLP: (() => void) | null = null;\n' +
      'try {\n' +
      '  /* DeviceEventEmitter is already imported at top of file. */\n' +
      '  DeviceEventEmitter.addListener(\'onTVKeyEvent\', (evt: any) => {\n' +
      '    if (evt && evt.eventType === \'longSelect\' && _v173FocusedLP) {\n' +
      '      try { _v173FocusedLP(); } catch (_) {}\n' +
      '    }\n' +
      '  });\n' +
      '} catch (_) { /* DeviceEventEmitter may not exist outside RN */ }\n' +
      '\n' +
      'export function v173RegisterLongPress(fn: (() => void) | null): void {\n' +
      '  _v173FocusedLP = fn;\n' +
      '}\n' +
      '\n' +
      headerAnchor;
    src = src.replace(headerAnchor, registry);
    changes++;

    // 1b) Ensure DeviceEventEmitter is in the react-native import.
    if (!/from\s*['"]react-native['"][^;]*DeviceEventEmitter/.test(src.split('export ')[0]) &&
        !/\bDeviceEventEmitter\b/.test(src.split('export ')[0])) {
      // Inject by extending an existing import line.  Find the first
      // "} from 'react-native'" and prepend DeviceEventEmitter to its list.
      const oldImp = "} from 'react-native';";
      const idx = src.indexOf(oldImp);
      if (idx === -1) {
        console.error('[v173] FATAL: ContentCard.tsx — no react-native import to extend.');
        process.exit(4);
      }
      // Find the matching opening brace
      const before = src.slice(0, idx);
      const openBrace = before.lastIndexOf('{');
      if (openBrace === -1) {
        console.error('[v173] FATAL: ContentCard.tsx — react-native import brace mismatch.');
        process.exit(5);
      }
      // Just append " DeviceEventEmitter," inside the brace block.
      src = src.slice(0, idx) + '  DeviceEventEmitter,\n' + src.slice(idx);
      changes++;
    }

    // 1c) Wire register/clear into handleFocus / handleBlur.  Splice right
    //     after the existing v169 prefetch block already added inside each.
    const oldHF =
      "      }, 900);\n" +
      "    }\n" +
      "  }, [onCardFocus, item]);";
    const newHF =
      "      }, 900);\n" +
      "    }\n" +
      "    /* V173_TV_LONGPRESS_REGISTRY — register this card's long-press\n" +
      "       handler so the global 'longSelect' listener can fire it. */\n" +
      "    try { v173RegisterLongPress(handleLongPress); } catch (_) {}\n" +
      "  }, [onCardFocus, item, handleLongPress]);";
    if (src.indexOf(oldHF) === -1) {
      console.error('[v173] FATAL: ContentCard.tsx — handleFocus tail not found.');
      process.exit(6);
    }
    src = src.replace(oldHF, newHF);
    changes++;

    const oldHB =
      "    /* V169_FOCUS_STREAM_PREWARM — abort the dwell timer if the user\n" +
      "       moved off before 500ms; nothing to do if the prefetch already fired. */\n" +
      "    if (_v169PrewarmTimerRef.current) {\n" +
      "      clearTimeout(_v169PrewarmTimerRef.current);\n" +
      "      _v169PrewarmTimerRef.current = null;\n" +
      "    }\n" +
      "  }, [onCardBlur]);";
    const newHB =
      "    /* V169_FOCUS_STREAM_PREWARM — abort the dwell timer if the user\n" +
      "       moved off before 500ms; nothing to do if the prefetch already fired. */\n" +
      "    if (_v169PrewarmTimerRef.current) {\n" +
      "      clearTimeout(_v169PrewarmTimerRef.current);\n" +
      "      _v169PrewarmTimerRef.current = null;\n" +
      "    }\n" +
      "    /* V173_TV_LONGPRESS_REGISTRY — clear long-press registration on blur. */\n" +
      "    try { v173RegisterLongPress(null); } catch (_) {}\n" +
      "  }, [onCardBlur]);";
    if (src.indexOf(oldHB) === -1) {
      console.error('[v173] FATAL: ContentCard.tsx — handleBlur tail not found.');
      process.exit(7);
    }
    src = src.replace(oldHB, newHB);
    changes++;

    write(file, src);
    console.log(`[v173] ContentCard.tsx: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 2: id.tsx -- wire EpisodeCard focus into the registry.
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = ID_PATH;
  let src = read(file);

  if (src.indexOf('V173_TV_LONGPRESS_EPISODE') !== -1) {
    console.log('[v173] [id].tsx: already patched (V173 marker present), skipping');
  } else {
    let changes = 0;

    // 2a) Add the import from ContentCard.
    const importAnchor = "import { ContentCard } from '../../../src/components/ContentCard';";
    let needsAltImport = false;
    if (src.indexOf(importAnchor) === -1) {
      // Try generic
      needsAltImport = true;
    }
    if (needsAltImport) {
      // Find any import from .../ContentCard and append our named import.
      const re = /import\s*\{[^}]*\}\s*from\s*['"][^'"]*ContentCard['"];/;
      const m = src.match(re);
      if (!m) {
        // No existing import — add a fresh one near the top.
        const topAnchor = "import React, ";
        if (src.indexOf(topAnchor) === -1) {
          console.error('[v173] FATAL: [id].tsx — could not place ContentCard import.');
          process.exit(8);
        }
        src = src.replace(
          topAnchor,
          "import { v173RegisterLongPress as _v173RegLP } from '../../../src/components/ContentCard';\n" + topAnchor
        );
      } else {
        // Extend the existing { ... } list with our alias.
        const old = m[0];
        const inserted = old.replace(/\{([^}]*)\}/, (_, inner) => {
          const trimmed = inner.replace(/\s+$/, '');
          const sep = trimmed.endsWith(',') ? '' : ',';
          return `{${trimmed}${sep} v173RegisterLongPress as _v173RegLP }`;
        });
        src = src.replace(old, inserted);
      }
      changes++;
    } else {
      src = src.replace(importAnchor, importAnchor + "\nimport { v173RegisterLongPress as _v173RegLP } from '../../../src/components/ContentCard';");
      changes++;
    }

    // 2b) Wire register/clear into EpisodeCard's onFocus/onBlur.  Use the
    //     existing `onFocus` handler inside EpisodeCard.  Since EpisodeCard
    //     is inline (line 656+), we splice on its Pressable's onFocus/onBlur.
    //
    //     The TouchableOpacity in EpisodeCard already has onLongPress wired;
    //     we need to add onFocus/onBlur if not present.  Search for the
    //     `onLongPress={isWatched ? onMarkUnwatched : undefined}` and inject
    //     onFocus/onBlur siblings.
    const epAnchor = "onLongPress={isWatched ? onMarkUnwatched : undefined}";
    if (src.indexOf(epAnchor) === -1) {
      console.error('[v173] FATAL: [id].tsx — could not locate EpisodeCard onLongPress.');
      process.exit(9);
    }
    const epNew = epAnchor +
      "\n      /* V173_TV_LONGPRESS_EPISODE — register the mark-unwatched callback\n" +
      "         while this card is focused so the TV 'longSelect' dispatcher in\n" +
      "         ContentCard.tsx can fire it.  Skips when nothing to unmark. */\n" +
      "      onFocus={() => { try { _v173RegLP(isWatched && typeof onMarkUnwatched === 'function' ? onMarkUnwatched : null); } catch (_) {} if (autoFocus) { /* preserve any existing autoFocus behaviour */ } }}\n" +
      "      onBlur={() => { try { _v173RegLP(null); } catch (_) {} }}";
    src = src.replace(epAnchor, epNew);
    changes++;

    write(file, src);
    console.log(`[v173] [id].tsx: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 3: player.tsx -- force watched mark on unmount when past 90%.
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = PLAYER_PATH;
  let src = read(file);

  if (src.indexOf('V173_FORCE_WATCHED_ON_EXIT') !== -1) {
    console.log('[v173] player.tsx: already patched (V173 marker present), skipping');
  } else {
    let changes = 0;

    // Splice IN the unmount cleanup: right before the existing api.watchProgress.save call.
    const oldUnmount =
      "      // Save current progress on exit\n" +
      "      if (currentPositionRef.current > 0 && currentDurationRef.current > 0 && contentId && contentType && isLive !== 'true') {\n" +
      "        console.log('[PLAYER] Saving progress on exit:', currentPositionRef.current / 1000, 's');";
    const newUnmount =
      "      // Save current progress on exit\n" +
      "      if (currentPositionRef.current > 0 && currentDurationRef.current > 0 && contentId && contentType && isLive !== 'true') {\n" +
      "        /* V173_FORCE_WATCHED_ON_EXIT — if the user fast-forwarded past 90%\n" +
      "           but backed out before the throttled saveProgress tick could fire,\n" +
      "           write privastream_watched here so the gold checkmark lands. */\n" +
      "        try {\n" +
      "          const _v173Pct = (currentPositionRef.current / currentDurationRef.current) * 100;\n" +
      "          if (_v173Pct >= 90) {\n" +
      "            const _v173Key = 'privastream_watched';\n" +
      "            AsyncStorage.getItem(_v173Key).then((raw) => {\n" +
      "              const set: Record<string, boolean> = raw ? JSON.parse(raw) : {};\n" +
      "              if (!set[contentId]) {\n" +
      "                set[contentId] = true;\n" +
      "                return AsyncStorage.setItem(_v173Key, JSON.stringify(set));\n" +
      "              }\n" +
      "            }).catch(() => {});\n" +
      "          }\n" +
      "        } catch (_) {}\n" +
      "        console.log('[PLAYER] Saving progress on exit:', currentPositionRef.current / 1000, 's');";
    if (src.indexOf(oldUnmount) === -1) {
      console.error('[v173] FATAL: player.tsx — could not locate unmount cleanup head.');
      process.exit(10);
    }
    src = src.replace(oldUnmount, newUnmount);
    changes++;

    write(file, src);
    console.log(`[v173] player.tsx: ${changes} change(s) applied`);
  }
}

console.log('[v173] DONE.  Rebuild your Expo app and sideload to test.');
