/*
 * apply_patches_v172_movie_watched_checkmark.js
 *
 * V172 — Movie poster watched checkmark + long-press unmark.
 *
 * Mirrors the EpisodeCard pattern (id.tsx line ~739):
 *   onLongPress={isWatched ? onMarkUnwatched : undefined}
 *
 * Implementation:
 *   1) Module-level watched-set cache hydrated once from
 *      AsyncStorage['privastream_watched'].
 *   2) Tiny pub/sub so all visible cards re-render the moment any
 *      one card un-marks (or the player marks something during a
 *      session).
 *   3) Inside ContentCard:
 *        • Render the existing styles.watchedBadge when the cached
 *          set says this content_id (or imdb_id) is watched.
 *        • On long-press, if the card is currently watched →
 *          confirmation alert → remove from set + AsyncStorage +
 *          notify subs.  If NOT watched → existing library toggle.
 *
 *   Series-episode pages keep using EpisodeCard.  This patch is
 *   strictly for the poster grid (Discover rows, Search results,
 *   Library, Continue Watching).
 *
 * Idempotent.  Re-running is a no-op once V172_WATCHED_REGISTRY
 * marker is present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v172_movie_watched_checkmark.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v172] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v172] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

const file = CC_PATH;
let src = read(file);

if (src.indexOf('V172_WATCHED_REGISTRY') !== -1) {
  console.log('[v172] ContentCard.tsx: already patched (V172 marker present), skipping');
  process.exit(0);
}

let changes = 0;

// ─────────────────────────────────────────────────────────────────────────────
//  1) Append the watched-set registry + pub/sub at module-level, right after
//     the existing v166 subscribePoster export.
// ─────────────────────────────────────────────────────────────────────────────
const anchor1 = "/* V166_POSTER_SUB — subscribe to canonical poster URL updates for a given id.";
if (src.indexOf(anchor1) === -1) {
  console.error('[v172] FATAL: ContentCard.tsx — V166 marker not found.  Apply v166 first.');
  process.exit(2);
}

// Locate the END of the v160SubscribePoster function so we can inject after it.
const v166EndAnchor =
  '  return () => {\n' +
  '    const s = _v166PosterSubs[key];\n' +
  '    if (s) { s.delete(cb); if (s.size === 0) delete _v166PosterSubs[key]; }\n' +
  '  };\n' +
  '}';
if (src.indexOf(v166EndAnchor) === -1) {
  console.error('[v172] FATAL: ContentCard.tsx — could not locate end of v160SubscribePoster body.');
  process.exit(3);
}
const v172Block =
  v166EndAnchor + '\n' +
  '\n' +
  '/* ─────────────────────────────────────────────────────────────────────────\n' +
  '   V172_WATCHED_REGISTRY — movie / episode watched flag, shared across every\n' +
  '   poster surface (Discover, Search, Library, Continue Watching).  Single\n' +
  '   source of truth: AsyncStorage["privastream_watched"].  Pub/sub so a long-\n' +
  '   press unmark on one card updates every other visible card that shows the\n' +
  '   same content. */\n' +
  'const _V172_KEY = \'privastream_watched\';\n' +
  'const _v172WatchedSet = new Set<string>();\n' +
  'const _v172Subs = new Set<() => void>();\n' +
  'let _v172Loaded = false;\n' +
  '\n' +
  'async function _v172Load(): Promise<void> {\n' +
  '  if (_v172Loaded) return;\n' +
  '  _v172Loaded = true;\n' +
  '  try {\n' +
  '    const raw = await AsyncStorage.getItem(_V172_KEY);\n' +
  '    if (raw) {\n' +
  '      const obj = JSON.parse(raw) as Record<string, boolean>;\n' +
  '      Object.keys(obj).forEach((k) => { if (obj[k]) _v172WatchedSet.add(k); });\n' +
  '    }\n' +
  '  } catch (_) { /* best-effort */ }\n' +
  '  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
  '}\n' +
  '/* Fire-and-forget hydration on module load. */\n' +
  '_v172Load();\n' +
  '\n' +
  'export function v172IsWatched(contentId: string | undefined | null): boolean {\n' +
  '  if (!contentId) return false;\n' +
  '  return _v172WatchedSet.has(String(contentId));\n' +
  '}\n' +
  '\n' +
  'export function v172SubscribeWatched(cb: () => void): () => void {\n' +
  '  _v172Subs.add(cb);\n' +
  '  /* Fire once on subscribe if hydration already completed. */\n' +
  '  if (_v172Loaded) { try { cb(); } catch (_) {} }\n' +
  '  return () => { _v172Subs.delete(cb); };\n' +
  '}\n' +
  '\n' +
  'export async function v172UnmarkWatched(contentId: string | undefined | null): Promise<void> {\n' +
  '  if (!contentId) return;\n' +
  '  const key = String(contentId);\n' +
  '  _v172WatchedSet.delete(key);\n' +
  '  try {\n' +
  '    const raw = await AsyncStorage.getItem(_V172_KEY);\n' +
  '    const obj = raw ? JSON.parse(raw) : {};\n' +
  '    delete obj[key];\n' +
  '    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));\n' +
  '  } catch (_) { /* best-effort -- in-memory delete still took effect */ }\n' +
  '  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });\n' +
  '}';
src = src.replace(v166EndAnchor, v172Block);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  2) Inside ContentCardComponent — subscribe to watched updates and derive
//     the per-card flag.  Splice right after the existing v160 lookup.
// ─────────────────────────────────────────────────────────────────────────────
const v160Anchor =
  '  const _v160_poster = v160GetPoster(_v160_id, (item as any).poster);\n';
if (src.indexOf(v160Anchor) === -1) {
  console.error('[v172] FATAL: ContentCard.tsx — could not locate v160 poster lookup anchor.');
  process.exit(4);
}
const v172CardInject =
  v160Anchor +
  '\n' +
  '  /* V172_WATCHED_REGISTRY — per-card derived flag + re-render hook.\n' +
  '     Subscribes to the module-level set so any long-press unmark (this\n' +
  '     card or another instance of the same content) instantly refreshes\n' +
  '     the badge across every surface. */\n' +
  '  const _v172ContentId = ((item as any).content_id || _v160_id) as string | undefined;\n' +
  '  const [, _v172Bump] = useState(0);\n' +
  '  useEffect(() => v172SubscribeWatched(() => _v172Bump((x) => (x + 1) & 0xff)), []);\n' +
  '  const _v172IsWatched = v172IsWatched(_v172ContentId);\n';
src = src.replace(v160Anchor, v172CardInject);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  3) Wrap handleLongPress: if the card is currently watched, route to a
//     "Mark as Unwatched?" confirmation instead of the library toggle.
// ─────────────────────────────────────────────────────────────────────────────
const oldLPHead = '  const handleLongPress = useCallback(async () => {';
if (src.indexOf(oldLPHead) === -1) {
  console.error('[v172] FATAL: ContentCard.tsx — could not locate handleLongPress head.');
  process.exit(5);
}
const newLPHead =
  '  const handleLongPress = useCallback(async () => {\n' +
  '    /* V172_WATCHED_REGISTRY — for an already-watched card, long-press\n' +
  '       removes the checkmark (mirrors EpisodeCard).  Falls through to\n' +
  '       the library toggle for unwatched cards. */\n' +
  '    if (_v172IsWatched && _v172ContentId) {\n' +
  '      const _v172Name = (item as any).name || (item as any).title || \'this title\';\n' +
  '      Alert.alert(\n' +
  '        \'Mark as Unwatched\',\n' +
  '        `Remove the watched checkmark from "${_v172Name}"?`,\n' +
  '        [\n' +
  '          { text: \'Cancel\', style: \'cancel\' },\n' +
  '          {\n' +
  '            text: \'Mark Unwatched\',\n' +
  '            style: \'destructive\',\n' +
  '            onPress: () => { v172UnmarkWatched(_v172ContentId); },\n' +
  '          },\n' +
  '        ],\n' +
  '      );\n' +
  '      return;\n' +
  '    }';
src = src.replace(oldLPHead, newLPHead);
changes++;

// Add _v172IsWatched + _v172ContentId to the handleLongPress deps array.
const oldDeps = '  }, [item, isInLibrary, onLibraryChange]);';
if (src.indexOf(oldDeps) === -1) {
  console.error('[v172] FATAL: ContentCard.tsx — could not locate handleLongPress deps array.');
  process.exit(6);
}
const newDeps =
  '  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);';
src = src.replace(oldDeps, newDeps);
changes++;

// ─────────────────────────────────────────────────────────────────────────────
//  4) Render the checkmark badge if the registry says watched, even when the
//     `watched` prop is falsy (so library / search / discover rows show it).
// ─────────────────────────────────────────────────────────────────────────────
const oldBadgeGate =
  '        {(watched ||\n' +
  '          (showProgress !== undefined &&\n' +
  '            showProgress >= 90)) && (';
if (src.indexOf(oldBadgeGate) === -1) {
  console.error('[v172] FATAL: ContentCard.tsx — could not locate watched-badge gate.');
  process.exit(7);
}
const newBadgeGate =
  '        {/* V172_WATCHED_REGISTRY — also show the badge when our cross-surface\n' +
  '            registry says this content_id is watched, even if no `watched`\n' +
  '            prop was passed from the parent (Discover rows, Search, Library). */}\n' +
  '        {(watched || _v172IsWatched ||\n' +
  '          (showProgress !== undefined &&\n' +
  '            showProgress >= 90)) && (';
src = src.replace(oldBadgeGate, newBadgeGate);
changes++;

write(file, src);
console.log(`[v172] ContentCard.tsx: ${changes} change(s) applied`);
console.log('[v172] DONE.  Rebuild your Expo app and sideload to test.');
