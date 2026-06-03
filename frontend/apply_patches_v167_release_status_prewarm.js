/*
 * apply_patches_v167_release_status_prewarm.js
 *
 * V167 — Cold-start IN CINEMA badge pre-warm.
 *
 *   Problem:
 *     On a cold Discover paint, posters render synchronously but each
 *     ContentCard's useEffect waits ~250ms (debounced batcher) AND a
 *     network round-trip before the "IN CINEMA" badge can appear.  The
 *     result: badge pops in ~600-800ms AFTER the poster.
 *
 *   Fix:
 *     1) Export v167PrewarmReleaseStatus(imdbIds[]) from ContentCard.tsx
 *        It fires one bulk /api/movie/release_status POST immediately
 *        (chunked to 50 ids), populates the existing _v77ReleaseCache
 *        and notifies any subscribers that mount during the in-flight
 *        period.  De-duplicates so the regular 250ms flush won't send a
 *        redundant request for the same ids.
 *
 *     2) In discover.tsx, the moment discoverData / cachedDiscover /
 *        continueWatching / cachedCW lands, collect all MOVIE imdb-ids
 *        and call prewarm exactly once per id (already-cached ids are
 *        skipped internally).
 *
 *   Result: by the time row cards mount and call _v77RequestReleaseStatus,
 *   the cache is hot → callback fires synchronously → badge paints on
 *   the SAME frame as the poster.
 *
 *   Net effect: ~600ms of cold-start badge lag gone, with one bulk
 *   network request instead of multiple debounced flushes.  Same total
 *   payload, faster perceived UX.
 *
 *   Idempotent.  Re-running this script is a no-op once the V167 markers
 *   are present.
 *
 *   Usage (Windows CMD, from project root):
 *       node apply_patches_v167_release_status_prewarm.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const CC_PATH  = path.join(ROOT, 'src', 'components', 'ContentCard.tsx');
const DSC_PATH = path.join(ROOT, 'app', '(tabs)', 'discover.tsx');

const _eolState = {};
function read(p) {
  if (!fs.existsSync(p)) {
    console.error(`[v167] FATAL: file not found: ${p}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(p, 'utf8');
  _eolState[p] = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  return _eolState[p] === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
}
function write(p, c) {
  const out = _eolState[p] === 'crlf' ? c.replace(/\r?\n/g, '\r\n') : c;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`[v167] wrote ${path.relative(ROOT, p) || p} (${_eolState[p].toUpperCase()})`);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 1: ContentCard.tsx
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = CC_PATH;
  let src = read(file);

  if (src.indexOf('V167_RELEASE_PREWARM') !== -1) {
    console.log('[v167] ContentCard.tsx: already patched (V167_RELEASE_PREWARM present), skipping');
  } else {
    let changes = 0;

    // 1a) Replace _v77RequestReleaseStatus to short-circuit when a prewarm
    //     fetch is already in flight for this id.
    const oldRequest =
      'function _v77RequestReleaseStatus(imdbId, cb) {\n' +
      '  if (_v77ReleaseCache.has(imdbId)) {\n' +
      '    cb(_v77ReleaseCache.get(imdbId));\n' +
      '    return () => {};\n' +
      '  }\n' +
      '  if (!_v77Subscribers.has(imdbId)) _v77Subscribers.set(imdbId, new Set());\n' +
      '  const subs = _v77Subscribers.get(imdbId);\n' +
      '  subs.add(cb);\n' +
      '  _v77PendingIds.add(imdbId);\n' +
      '  if (!_v77FlushTimer) _v77FlushTimer = setTimeout(_v77FlushBatch, 250);\n' +
      '  return () => {\n' +
      '    const s = _v77Subscribers.get(imdbId);\n' +
      '    if (s) s.delete(cb);\n' +
      '  };\n' +
      '}';

    const newRequest =
      '/* V167_RELEASE_PREWARM — ids currently in-flight via prewarm. */\n' +
      'const _v167InFlight = new Set();\n' +
      'function _v77RequestReleaseStatus(imdbId, cb) {\n' +
      '  if (_v77ReleaseCache.has(imdbId)) {\n' +
      '    cb(_v77ReleaseCache.get(imdbId));\n' +
      '    return () => {};\n' +
      '  }\n' +
      '  if (!_v77Subscribers.has(imdbId)) _v77Subscribers.set(imdbId, new Set());\n' +
      '  const subs = _v77Subscribers.get(imdbId);\n' +
      '  subs.add(cb);\n' +
      '  /* V167_RELEASE_PREWARM — if a prewarm POST already covers this id,\n' +
      '     just subscribe; do NOT queue a duplicate batched request. */\n' +
      '  if (!_v167InFlight.has(imdbId)) {\n' +
      '    _v77PendingIds.add(imdbId);\n' +
      '    if (!_v77FlushTimer) _v77FlushTimer = setTimeout(_v77FlushBatch, 250);\n' +
      '  }\n' +
      '  return () => {\n' +
      '    const s = _v77Subscribers.get(imdbId);\n' +
      '    if (s) s.delete(cb);\n' +
      '  };\n' +
      '}\n' +
      '\n' +
      '/* V167_RELEASE_PREWARM — bulk-prefetch release statuses BEFORE cards\n' +
      '   mount.  Discover screen calls this the moment its data arrives, so\n' +
      '   by the time individual ContentCards subscribe the cache is already\n' +
      '   hot and the IN CINEMA badge paints on the same frame as the poster. */\n' +
      'export function v167PrewarmReleaseStatus(imdbIds: string[] | undefined | null): void {\n' +
      '  if (!Array.isArray(imdbIds) || imdbIds.length === 0) return;\n' +
      '  const seen = new Set<string>();\n' +
      '  const todo: string[] = [];\n' +
      '  for (const raw of imdbIds) {\n' +
      '    if (!raw) continue;\n' +
      '    const id = String(raw);\n' +
      '    if (!id.startsWith(\'tt\')) continue;\n' +
      '    if (_v77ReleaseCache.has(id)) continue;\n' +
      '    if (_v167InFlight.has(id)) continue;\n' +
      '    if (seen.has(id)) continue;\n' +
      '    seen.add(id);\n' +
      '    todo.push(id);\n' +
      '    _v167InFlight.add(id);\n' +
      '    /* Claim ownership from the regular batcher so it can\'t fire a\n' +
      '       duplicate POST for these same ids. */\n' +
      '    _v77PendingIds.delete(id);\n' +
      '  }\n' +
      '  if (todo.length === 0) return;\n' +
      '\n' +
      '  const backendUrl =\n' +
      '    process.env.EXPO_PUBLIC_BACKEND_URL ||\n' +
      '    (Constants as any).expoConfig?.extra?.backendUrl ||\n' +
      '    \'\';\n' +
      '\n' +
      '  /* Chunk to mirror the existing 50-id batch ceiling. */\n' +
      '  const chunks: string[][] = [];\n' +
      '  for (let i = 0; i < todo.length; i += 50) chunks.push(todo.slice(i, i + 50));\n' +
      '\n' +
      '  chunks.forEach(async (ids) => {\n' +
      '    const finish = (statusForAll: string | null, data: any) => {\n' +
      '      ids.forEach(id => {\n' +
      '        const status = data ? ((data[id] as string) || \'none\') : (statusForAll || \'none\');\n' +
      '        _v77ReleaseCache.set(id, status);\n' +
      '        _v167InFlight.delete(id);\n' +
      '        const subs = _v77Subscribers.get(id);\n' +
      '        if (subs) {\n' +
      '          subs.forEach(cb => { try { (cb as any)(status); } catch (_) {} });\n' +
      '          _v77Subscribers.delete(id);\n' +
      '        }\n' +
      '      });\n' +
      '    };\n' +
      '    try {\n' +
      '      const res = await fetch(`${backendUrl}/api/movie/release_status`, {\n' +
      '        method: \'POST\',\n' +
      '        headers: { \'Content-Type\': \'application/json\' },\n' +
      '        body: JSON.stringify({ imdb_ids: ids }),\n' +
      '      });\n' +
      '      if (!res.ok) { finish(\'none\', null); return; }\n' +
      '      const data = await res.json();\n' +
      '      finish(null, data);\n' +
      '    } catch (_) {\n' +
      '      finish(\'none\', null);\n' +
      '    }\n' +
      '  });\n' +
      '}';

    if (src.indexOf(oldRequest) === -1) {
      console.error('[v167] FATAL: ContentCard.tsx — could not locate _v77RequestReleaseStatus body to replace.');
      process.exit(2);
    }
    src = src.replace(oldRequest, newRequest);
    changes++;

    write(file, src);
    console.log(`[v167] ContentCard.tsx: ${changes} change(s) applied`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH 2: discover.tsx
// ─────────────────────────────────────────────────────────────────────────────
{
  const file = DSC_PATH;
  let src = read(file);

  if (src.indexOf('V167_RELEASE_PREWARM') !== -1) {
    console.log('[v167] discover.tsx: already patched (V167_RELEASE_PREWARM present), skipping');
  } else {
    let changes = 0;

    // 2a) Extend the existing ContentCard import to pull in the new prewarm fn.
    const oldImport = "import { getCardWidth, v160GetPoster as _v160GetPoster, v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */ } from '../../src/components/ContentCard';";
    const newImport = "import { getCardWidth, v160GetPoster as _v160GetPoster, v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */, v167PrewarmReleaseStatus as _v167PrewarmReleaseStatus /* V167_RELEASE_PREWARM */ } from '../../src/components/ContentCard';";
    if (src.indexOf(oldImport) === -1) {
      console.error('[v167] FATAL: discover.tsx — could not locate V166 ContentCard import line to extend.');
      process.exit(3);
    }
    src = src.replace(oldImport, newImport);
    changes++;

    // 2b) Inject the prewarm useEffect immediately AFTER the V144_CACHE_PERSIST
    //     CW snapshot useEffect (a stable, unique anchor that exists in the file).
    const anchor =
      '  useEffect(() => {\n' +
      '    try {\n' +
      '      AsyncStorage.setItem(\'@ps_cw_v1\', JSON.stringify(continueWatching || [])).catch(() => {});\n' +
      '    } catch (_) {}\n' +
      '  }, [continueWatching]);\n';
    if (src.indexOf(anchor) === -1) {
      console.error('[v167] FATAL: discover.tsx — could not locate CW persist useEffect anchor.');
      process.exit(4);
    }
    const inject =
      anchor +
      '\n' +
      '  // V167_RELEASE_PREWARM — fire ONE bulk /api/movie/release_status POST\n' +
      '  // as soon as we know which movies are on screen.  By the time row\n' +
      '  // ContentCards mount and subscribe, the cache is already hot and the\n' +
      '  // IN CINEMA badge paints on the same frame as the poster.  Skips ids\n' +
      '  // that are already cached or in-flight (so back-nav is a no-op).\n' +
      '  useEffect(() => {\n' +
      '    const ids: string[] = [];\n' +
      '    const seen = new Set<string>();\n' +
      '    const collect = (rawId: any) => {\n' +
      '      if (!rawId) return;\n' +
      '      const id = String(rawId);\n' +
      '      if (!id.startsWith(\'tt\')) return;\n' +
      '      if (seen.has(id)) return;\n' +
      '      seen.add(id);\n' +
      '      ids.push(id);\n' +
      '    };\n' +
      '    const harvest = (services: any) => {\n' +
      '      if (!services || typeof services !== \'object\') return;\n' +
      '      for (const svc of Object.values(services) as any[]) {\n' +
      '        if (!svc) continue;\n' +
      '        const movies = (svc as any).movies;\n' +
      '        if (Array.isArray(movies)) {\n' +
      '          for (const m of movies) collect(m && (m.imdb_id || m.id));\n' +
      '        }\n' +
      '      }\n' +
      '    };\n' +
      '    harvest((discoverData as any)?.services);\n' +
      '    harvest((cachedDiscover as any)?.services);\n' +
      '    /* Continue Watching: only fetch release status for movies. */\n' +
      '    const harvestCW = (list: any) => {\n' +
      '      if (!Array.isArray(list)) return;\n' +
      '      for (const it of list) {\n' +
      '        if (!it) continue;\n' +
      '        const t = (it as any).content_type || (it as any).type;\n' +
      '        if (t && t !== \'movie\') continue;\n' +
      '        collect((it as any).content_id || (it as any).imdb_id || (it as any).id);\n' +
      '      }\n' +
      '    };\n' +
      '    harvestCW(continueWatching);\n' +
      '    harvestCW(cachedCW);\n' +
      '    if (ids.length > 0) _v167PrewarmReleaseStatus(ids);\n' +
      '  }, [discoverData, cachedDiscover, continueWatching, cachedCW]);\n';
    src = src.replace(anchor, inject);
    changes++;

    write(file, src);
    console.log(`[v167] discover.tsx: ${changes} change(s) applied`);
  }
}

console.log('[v167] DONE.  Rebuild your Expo app and sideload to test.');
