/* eslint-disable */
// apply_patches_v138_focus_stream_prefetch.js
//
// FRONTEND FOCUS-PREFETCH FOR FIRST-CLICK SPEED
//
// When a poster sits focused for 350ms we already prefetch metadata
// (PATCH_V47_FOCUS_DEBOUNCE).  This patch ADDS a second debounce timer
// at 900ms that prefetches /api/streams for the focused MOVIE poster.
// Series posters are skipped (the series root doesn't fetch streams --
// only the episode page does, and we don't know which episode the user
// will click).
//
// Why two debounce timers?
//   * Meta prefetch (350ms) is cheap -- small JSON, low backend cost.
//   * Stream prefetch (900ms) hits all addons in parallel -- expensive.
//     900ms means "user intentionally paused on this poster", not just
//     "user D-pad'd through it".  Keeps backend load reasonable.
//
// Combined with v137's backend early-return:
//   * Click immediately after focusing  -> v137 path, 3-4s
//   * Click after 1+ sec on poster      -> store cache hit, <500ms
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v138_focus_stream_prefetch.js -o apply_patches_v138.js && node apply_patches_v138.js
//
const fs = require('fs');
const path = require('path');

function find(rel) {
  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), 'frontend', rel),
    path.join(process.cwd(), '..', 'frontend', rel),
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

const discoverPath = find(path.join('app', '(tabs)', 'discover.tsx'));
if (!discoverPath) {
  console.error('[v138] FATAL: app/(tabs)/discover.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(discoverPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = discoverPath + '.bak_v138';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v138] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  const old2 = oldStr.replace(/\r?\n/g, NL);
  const new2 = newStr.replace(/\r?\n/g, NL);
  const occurrences = src.split(old2).length - 1;
  if (occurrences === 0) { reports.push({ label, status: 'NOT_FOUND' }); return false; }
  if (occurrences > 1)  { reports.push({ label, status: 'AMBIGUOUS', count: occurrences }); return false; }
  const before = src.length;
  src = src.replace(old2, new2);
  reports.push({ label, status: 'OK', delta: src.length - before });
  return true;
}

// ---------------------------------------------------------------------------
// F1 — extend handleItemFocus to also prefetch /api/streams for movies
// after a longer 900ms debounce.  Reuses the content-store's fetchStreams
// so the result lands in BOTH the React store cache AND the server-side
// 2-minute cache.  When the user clicks the poster, id.tsx's mount-time
// fetchStreams hits the store -> instant render.
// ---------------------------------------------------------------------------
const F1_OLD = `  const prefetchingRef = useRef<Set<string>>(new Set());
  const focusDebounceTimerRef = useRef<any>(null);
  const pendingFocusItemRef = useRef<ContentItem | null>(null);
  const handleItemFocus = useCallback((item: ContentItem) => {
    pendingFocusItemRef.current = item;
    if (focusDebounceTimerRef.current) clearTimeout(focusDebounceTimerRef.current);
    focusDebounceTimerRef.current = setTimeout(() => {
      focusDebounceTimerRef.current = null;
      const it = pendingFocusItemRef.current;
      if (!it) return;
      const id = it.imdb_id || it.id;
      if (!id || prefetchingRef.current.has(id) || getMetaCache(id)) return;
      prefetchingRef.current.add(id);
      api.content.getMeta(it.type, id).then((meta) => {
        setMetaCache(id, meta);
        if (meta.background) {
          try { Image.prefetch(meta.background); } catch (_) {}
        }
      }).catch(() => {});
    }, 350);
  }, []);`;

const F1_NEW = `  const prefetchingRef = useRef<Set<string>>(new Set());
  const focusDebounceTimerRef = useRef<any>(null);
  const pendingFocusItemRef = useRef<ContentItem | null>(null);
  /* v138-stream-prefetch */
  // Second-tier prefetch: at 900ms of stable focus on a MOVIE poster,
  // kick off /api/streams.  Lands in both the content-store cache AND
  // the server-side 2-min cache, so the eventual click is a cache hit.
  const streamPrefetchingRef = useRef<Set<string>>(new Set());
  const streamPrefetchTimerRef = useRef<any>(null);
  const fetchStreamsForPrefetch = useContentStore(s => s.fetchStreams);
  const handleItemFocus = useCallback((item: ContentItem) => {
    pendingFocusItemRef.current = item;
    if (focusDebounceTimerRef.current) clearTimeout(focusDebounceTimerRef.current);
    if (streamPrefetchTimerRef.current) clearTimeout(streamPrefetchTimerRef.current);
    focusDebounceTimerRef.current = setTimeout(() => {
      focusDebounceTimerRef.current = null;
      const it = pendingFocusItemRef.current;
      if (!it) return;
      const id = it.imdb_id || it.id;
      if (!id || prefetchingRef.current.has(id) || getMetaCache(id)) return;
      prefetchingRef.current.add(id);
      api.content.getMeta(it.type, id).then((meta) => {
        setMetaCache(id, meta);
        if (meta.background) {
          try { Image.prefetch(meta.background); } catch (_) {}
        }
      }).catch(() => {});
    }, 350);
    // v138: stream prefetch on extended focus.  Movies only -- series
    // posters land on the series root (no stream fetch there).
    streamPrefetchTimerRef.current = setTimeout(() => {
      streamPrefetchTimerRef.current = null;
      const it = pendingFocusItemRef.current;
      if (!it) return;
      if (it.type !== 'movie') return;
      const id = it.imdb_id || it.id;
      if (!id || streamPrefetchingRef.current.has(id)) return;
      streamPrefetchingRef.current.add(id);
      console.log('[PREFETCH v138] kicking /api/streams for focused movie', id);
      try {
        fetchStreamsForPrefetch(it.type, id);
      } catch (e) {
        console.log('[PREFETCH v138] failed', e);
      }
    }, 900);
  }, [fetchStreamsForPrefetch]);`;

applyOnce(
  'F1: add stream prefetch on extended poster focus (movies only)',
  '/* v138-stream-prefetch */',
  F1_OLD,
  F1_NEW
);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v138] === PATCH REPORT =====================================');
for (const r of reports) {
  let tag;
  if (r.status === 'OK') tag = 'OK  ';
  else if (r.status === 'SKIP_IDEMPOTENT') tag = 'SKIP';
  else if (r.status === 'NOT_FOUND') tag = 'MISS';
  else tag = 'AMBI';
  let extras = '';
  if (r.delta != null) extras += `  (Δ ${r.delta} chars)`;
  if (r.count != null) extras += `  (×${r.count})`;
  console.log(`  [${tag}] ${r.label}${extras}`);
}
console.log('[v138] =====================================================');

if (failed.length) { console.error('[v138] Patch failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v138] No changes.'); process.exit(0); }
fs.writeFileSync(discoverPath, src, 'utf8');
console.log(`[v138] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v138] Done. Rebuild + side-load.');
