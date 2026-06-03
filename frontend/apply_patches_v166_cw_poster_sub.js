/*
 * apply_patches_v166_cw_poster_sub.js
 *
 * V166 — Continue Watching poster subscription
 *
 *   Problem:
 *     Continue Watching renders BEFORE addon rows finish populating the
 *     V160 poster registry. CW does a one-shot lookup, gets nothing,
 *     falls back to its snapshot poster from /api/watch-progress, and
 *     never re-renders when the canonical poster lands in the registry.
 *
 *   Fix:
 *     1) Promote the V160 registry to a tiny pub/sub.
 *     2) Make ContinueWatchingItem subscribe to its content_id, hold
 *        the resolved URL in state, and prefer it over the snapshot.
 *
 *   Idempotent.  Re-running this script is a no-op once the V166 markers
 *   are present.
 *
 *   Usage (from project root on Windows CMD):
 *       node apply_patches_v166_cw_poster_sub.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH  = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const DSC_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');

// File state: track CRLF/LF so we preserve the original line-ending style on write.
const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v166] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  // Detect CRLF vs LF.  If any \r\n exists we treat the file as CRLF and
  // normalize to \n for patching, then re-emit \r\n on write.
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v166] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 1: ContentCard.tsx — add pub/sub to V160 registry
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = CC_PATH;
  let src = read(file);
  let changes = 0;

  if (src.indexOf('V166_POSTER_SUB') !== -1) {
    console.log('[v166] ContentCard.tsx: already patched (V166_POSTER_SUB present), skipping');
  } else {
    // Locate the existing v160RegisterPoster function and replace its body
    // with a version that notifies subscribers when a NEW entry is recorded.
    const oldRegister =
      'export function v160RegisterPoster(imdbId: string | undefined | null, url: string | undefined | null): void {\n' +
      '  if (!imdbId || !url) return;\n' +
      '  // strip any episode suffix like "tt1234:1:5" so episodes share the series-level poster\n' +
      '  const key = String(imdbId).split(\':\')[0];\n' +
      '  if (!key) return;\n' +
      '  if (!_v160PosterRegistry[key]) _v160PosterRegistry[key] = String(url);\n' +
      '}';

    const newRegister =
      '// V166_POSTER_SUB — subscriber map keyed by canonical (series-level) id.\n' +
      'const _v166PosterSubs: Record<string, Set<(url: string) => void>> = {};\n' +
      'export function v160RegisterPoster(imdbId: string | undefined | null, url: string | undefined | null): void {\n' +
      '  if (!imdbId || !url) return;\n' +
      '  // strip any episode suffix like "tt1234:1:5" so episodes share the series-level poster\n' +
      '  const key = String(imdbId).split(\':\')[0];\n' +
      '  if (!key) return;\n' +
      '  if (!_v160PosterRegistry[key]) {\n' +
      '    _v160PosterRegistry[key] = String(url);\n' +
      '    /* V166_POSTER_SUB — notify any subscribers (e.g. Continue Watching) */\n' +
      '    const subs = _v166PosterSubs[key];\n' +
      '    if (subs && subs.size) {\n' +
      '      subs.forEach(cb => { try { cb(String(url)); } catch (_) {} });\n' +
      '    }\n' +
      '  }\n' +
      '}\n' +
      '/* V166_POSTER_SUB — subscribe to canonical poster URL updates for a given id.\n' +
      '   Fires immediately with the current value if one exists.  Returns an\n' +
      '   unsubscribe function. */\n' +
      'export function v160SubscribePoster(imdbId: string | undefined | null, cb: (url: string) => void): () => void {\n' +
      '  if (!imdbId || typeof cb !== \'function\') return () => {};\n' +
      '  const key = String(imdbId).split(\':\')[0];\n' +
      '  if (!key) return () => {};\n' +
      '  const existing = _v160PosterRegistry[key];\n' +
      '  if (existing) { try { cb(existing); } catch (_) {} }\n' +
      '  if (!_v166PosterSubs[key]) _v166PosterSubs[key] = new Set();\n' +
      '  _v166PosterSubs[key].add(cb);\n' +
      '  return () => {\n' +
      '    const s = _v166PosterSubs[key];\n' +
      '    if (s) { s.delete(cb); if (s.size === 0) delete _v166PosterSubs[key]; }\n' +
      '  };\n' +
      '}';

    if (src.indexOf(oldRegister) === -1) {
      console.error('[v166] FATAL: ContentCard.tsx — could not locate v160RegisterPoster body to replace.');
      console.error('       The file may have been edited since the last upload.  Re-upload ContentCard.tsx and rerun.');
      process.exit(2);
    }
    src = src.replace(oldRegister, newRegister);
    changes++;

    write(file, src);
    console.log(`[v166] ContentCard.tsx: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 2: discover.tsx — subscribe in ContinueWatchingItem
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = DSC_PATH;
  let src = read(file);
  let changes = 0;

  if (src.indexOf('V166_POSTER_SUB') !== -1) {
    console.log('[v166] discover.tsx: already patched (V166_POSTER_SUB present), skipping');
  } else {
    // 2a) Add v160SubscribePoster to the existing import from ContentCard.
    const oldImport = "import { getCardWidth, v160GetPoster as _v160GetPoster /* V160_IMPORT_POSTER_REGISTRY */ } from '../../src/components/ContentCard';";
    const newImport = "import { getCardWidth, v160GetPoster as _v160GetPoster, v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */ } from '../../src/components/ContentCard';";
    if (src.indexOf(oldImport) === -1) {
      console.error('[v166] FATAL: discover.tsx — could not locate V160 import line to extend.');
      process.exit(3);
    }
    src = src.replace(oldImport, newImport);
    changes++;

    // 2b) Inject subscription hook inside ContinueWatchingItem.
    // Splice immediately after the existing `const percentWatched = ...` line
    // because that line is unique and lives at the very top of the component.
    const anchor = '  const percentWatched = item.percent_watched || 0;\n';
    if (src.indexOf(anchor) === -1) {
      console.error('[v166] FATAL: discover.tsx — could not locate ContinueWatchingItem anchor (percentWatched line).');
      process.exit(4);
    }
    const inject =
      anchor +
      '\n' +
      '  // V166_POSTER_SUB — subscribe to the canonical poster URL so this card\n' +
      '  // re-renders the moment an addon-row ContentCard registers the proper\n' +
      '  // poster for the same content_id.  Initial value uses the synchronous\n' +
      '  // lookup so the first paint already gets whatever is in the registry.\n' +
      '  const [_v166Poster, _v166SetPoster] = useState<string>(\n' +
      '    () => _v160GetPoster((item as any).content_id, item.poster)\n' +
      '  );\n' +
      '  useEffect(() => {\n' +
      '    const unsub = _v160SubscribePoster((item as any).content_id, (u: string) => _v166SetPoster(u));\n' +
      '    return unsub;\n' +
      '  }, [(item as any).content_id]);\n';
    src = src.replace(anchor, inject);
    changes++;

    // 2c) Swap the two inline _v160GetPoster lookups inside the <Image> block
    //     to use the subscribed state.
    const oldGate =
      '          {(_v160GetPoster((item as any).content_id, item.poster) || item.backdrop) ? (\n' +
      '            <Image\n' +
      '              source={{ uri: _v160GetPoster((item as any).content_id, item.poster) || item.backdrop || \'\' }}';
    const newGate =
      '          {/* V166_POSTER_SUB — read the subscribed canonical URL */}\n' +
      '          {(_v166Poster || item.backdrop) ? (\n' +
      '            <Image\n' +
      '              source={{ uri: _v166Poster || item.backdrop || \'\' }}';
    if (src.indexOf(oldGate) === -1) {
      console.error('[v166] FATAL: discover.tsx — could not locate the V160 CW <Image> block to swap.');
      process.exit(5);
    }
    src = src.replace(oldGate, newGate);
    changes++;

    write(file, src);
    console.log(`[v166] discover.tsx: ${changes} change(s) applied`);
  }
}

console.log('[v166] DONE.  Rebuild your Expo app and sideload to test.');
