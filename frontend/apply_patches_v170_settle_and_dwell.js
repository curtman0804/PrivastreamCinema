/*
 * apply_patches_v170_settle_and_dwell.js
 *
 * V170 — Eliminate residual stream-count flicker + reduce back-nav lag
 *        from over-eager focus prefetches.
 *
 * Two surgical changes:
 *
 * ───────────────────────────────────────────────────────────────────
 *  (A) V170_STREAMS_SETTLE       src/store/contentStore.ts
 * ───────────────────────────────────────────────────────────────────
 *  Replace the existing 150ms hard-throttle on progressive stream
 *  updates with a "settle-debounce" that ONLY commits to the UI when
 *  either:
 *    • no new merge has arrived for 400ms (the list has stabilized), OR
 *    • all sources have completed (final set fires immediately).
 *
 *  Net effect:
 *    - Cold cache + v157/v161 filter no longer ticks "5 → 9 → 8" as
 *      sources merge.  User sees one transition from spinner -> final
 *      count.
 *    - First paint is at most 400ms later than today, and only when
 *      sources are actively trickling in.
 *
 * ───────────────────────────────────────────────────────────────────
 *  (B) V170_FOCUS_DWELL_TUNE     src/components/ContentCard.tsx
 * ───────────────────────────────────────────────────────────────────
 *  v169 introduced a 500ms dwell-then-prefetch on poster focus.  D-pad
 *  flying through a row of posters could fire 5+ in-flight prefetches,
 *  each kicking off a 3-source fan-out (Backend + Torrentio + TPB+).
 *  That spike contended with the user's actual click→details fetch and
 *  the stack-pop animation when backing out, producing a perceptible
 *  back-nav lag.
 *
 *  Fix:
 *    • Bump dwell 500 → 900ms so the user has to actually pause.
 *    • Cap concurrent prefetches at 2 (module-level token bucket).
 *      Beyond the cap, the request is silently dropped — fetchStreams
 *      will run on click as it does today (no degradation, just no
 *      acceleration for that one card).
 *
 * Idempotent.  Re-running is a no-op once V170 markers are present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v170_settle_and_dwell.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const STORE_PATH = path.join(ROOT, 'src', 'store', 'contentStore.ts');
const CC_PATH    = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v170] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v170] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 1: contentStore.ts — settle-debounce instead of 150ms throttle
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = STORE_PATH;
  let src = read(file);

  if (src.indexOf('V170_STREAMS_SETTLE') !== -1) {
    console.log('[v170] contentStore.ts: already patched (V170 marker present), skipping');
  } else {
    let changes = 0;

    // Replace the throttled-progressive block with a settle-debounce.
    const oldBlock =
      '      let _v19LastSet = 0;\n' +
      '      let _v19PendingTimer: any = null;\n' +
      '      let _v19PendingStreams: Stream[] = [];\n' +
      '      const flushPending = () => {\n' +
      '        if (_v19PendingStreams.length === 0) return;\n' +
      '        _v19LastSet = Date.now();\n' +
      '        set({ streams: _v19PendingStreams, isLoadingStreams: false });\n' +
      '        _v19PendingStreams = [];\n' +
      '      };\n' +
      '      const result = await api.addons.getAllStreams(type, id, (partialStreams: Stream[]) => {\n' +
      '        _v19PendingStreams = partialStreams;\n' +
      '        const elapsed = Date.now() - _v19LastSet;\n' +
      '        if (elapsed >= 150) {\n' +
      '          if (_v19PendingTimer) { clearTimeout(_v19PendingTimer); _v19PendingTimer = null; }\n' +
      '          flushPending();\n' +
      '        } else if (!_v19PendingTimer) {\n' +
      '          _v19PendingTimer = setTimeout(() => { _v19PendingTimer = null; flushPending(); }, 150 - elapsed);\n' +
      '        }\n' +
      '      });\n' +
      '      if (_v19PendingTimer) { clearTimeout(_v19PendingTimer); _v19PendingTimer = null; }';

    const newBlock =
      '      /* V170_STREAMS_SETTLE — settle-debounce instead of hard 150ms\n' +
      '         throttle.  The UI only sees an update when streams have been\n' +
      '         stable for 400ms (or all sources have completed), so the\n' +
      '         filtered count no longer ticks "5 -> 9 -> 8" as Backend /\n' +
      '         Torrentio / TPB+ merge progressively. */\n' +
      '      let _v170Pending: Stream[] = [];\n' +
      '      let _v170SettleTimer: any = null;\n' +
      '      const _v170Flush = () => {\n' +
      '        if (_v170Pending.length === 0) return;\n' +
      '        const snapshot = _v170Pending;\n' +
      '        _v170Pending = [];\n' +
      '        set({ streams: snapshot, isLoadingStreams: false });\n' +
      '      };\n' +
      '      const result = await api.addons.getAllStreams(type, id, (partialStreams: Stream[]) => {\n' +
      '        _v170Pending = partialStreams;\n' +
      '        if (_v170SettleTimer) { clearTimeout(_v170SettleTimer); _v170SettleTimer = null; }\n' +
      '        _v170SettleTimer = setTimeout(() => {\n' +
      '          _v170SettleTimer = null;\n' +
      '          _v170Flush();\n' +
      '        }, 400);\n' +
      '      });\n' +
      '      if (_v170SettleTimer) { clearTimeout(_v170SettleTimer); _v170SettleTimer = null; }';

    if (src.indexOf(oldBlock) === -1) {
      console.error('[v170] FATAL: contentStore.ts — could not locate v19 throttle block to replace.');
      process.exit(2);
    }
    src = src.replace(oldBlock, newBlock);
    changes++;

    write(file, src);
    console.log(`[v170] contentStore.ts: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 2: ContentCard.tsx — dwell tune + concurrent prefetch cap
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V170_FOCUS_DWELL_TUNE') !== -1) {
    console.log('[v170] ContentCard.tsx: already patched (V170 marker present), skipping');
  } else {
    let changes = 0;

    // 2a) Add a module-level prefetch-concurrency cap RIGHT AFTER the v169 import.
    const importAnchor =
      "import { useContentStore as _v169UseContentStore /* V169_FOCUS_STREAM_PREWARM */ } from '../store/contentStore';";
    if (src.indexOf(importAnchor) === -1) {
      console.error('[v170] FATAL: ContentCard.tsx — V169 import anchor missing.  Apply v169 first.');
      process.exit(3);
    }
    src = src.replace(
      importAnchor,
      importAnchor +
        '\n' +
        '/* V170_FOCUS_DWELL_TUNE — cap concurrent focus-prefetches so D-pad\n' +
        '   fly-throughs cannot saturate the JS bridge / backend.  Beyond the\n' +
        '   cap, prefetches are silently dropped (the on-click fetch still\n' +
        '   works, just without the warm-cache acceleration). */\n' +
        'let _v170PrefetchInflight = 0;\n' +
        'const _V170_PREFETCH_CAP = 2;'
    );
    changes++;

    // 2b) Update the v169 handleFocus body: bump dwell, gate by the cap, and
    //     decrement on completion.
    const oldFocusBody =
      '    if (_v169_cid && _v169_type === \'movie\' && String(_v169_cid).startsWith(\'tt\')) {\n' +
      '      _v169PrewarmTimerRef.current = setTimeout(() => {\n' +
      '        try {\n' +
      '          const _v169_pf = _v169UseContentStore.getState().prefetchStreams;\n' +
      '          if (typeof _v169_pf === \'function\') _v169_pf(_v169_type, String(_v169_cid));\n' +
      '        } catch (_) { /* prefetch is best-effort */ }\n' +
      '      }, 500);\n' +
      '    }';

    const newFocusBody =
      '    if (_v169_cid && _v169_type === \'movie\' && String(_v169_cid).startsWith(\'tt\')) {\n' +
      '      /* V170_FOCUS_DWELL_TUNE — 900ms dwell + concurrency cap so D-pad\n' +
      '         scrolling doesn\'t flood the backend and the JS bridge. */\n' +
      '      _v169PrewarmTimerRef.current = setTimeout(() => {\n' +
      '        if (_v170PrefetchInflight >= _V170_PREFETCH_CAP) return;\n' +
      '        _v170PrefetchInflight++;\n' +
      '        try {\n' +
      '          const _v169_pf = _v169UseContentStore.getState().prefetchStreams;\n' +
      '          if (typeof _v169_pf === \'function\') {\n' +
      '            const _p = _v169_pf(_v169_type, String(_v169_cid));\n' +
      '            if (_p && typeof (_p as any).then === \'function\') {\n' +
      '              (_p as any).finally(() => { _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1); });\n' +
      '            } else {\n' +
      '              _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1);\n' +
      '            }\n' +
      '          } else {\n' +
      '            _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1);\n' +
      '          }\n' +
      '        } catch (_) {\n' +
      '          _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1);\n' +
      '        }\n' +
      '      }, 900);\n' +
      '    }';

    if (src.indexOf(oldFocusBody) === -1) {
      console.error('[v170] FATAL: ContentCard.tsx — could not locate v169 focus body to upgrade.');
      process.exit(4);
    }
    src = src.replace(oldFocusBody, newFocusBody);
    changes++;

    write(file, src);
    console.log(`[v170] ContentCard.tsx: ${changes} change(s) applied`);
  }
}

console.log('[v170] DONE.  Rebuild your Expo app and sideload to test.');
