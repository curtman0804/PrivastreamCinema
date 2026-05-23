/**
 * apply_patches_v77e.js — complete In-Cinemas badge wiring for ContentCard
 * ========================================================================
 * v77b failed at the StyleSheet anchor due to CRLF and rolled back BEFORE
 * writing — so the imports, batcher, state, useEffect, and badge JSX
 * never landed in ContentCard.tsx. Only v77c (styles) actually applied.
 *
 * This script does the COMPLETE injection in one shot using single-line,
 * CRLF-safe anchors. It is idempotent at each step (checks if marker is
 * already present before injecting). Skips the StyleSheet block — v77c
 * already handled that.
 *
 * Type filter is opt-OUT from the start (skips series/tv/channel/episode
 * but lets everything else through, since most discover items don't carry
 * an explicit `type: 'movie'` field).
 *
 * Idempotent. CRLF-safe.
 *
 * Run from project root:
 *   node apply_patches_v77e.js
 */

const fs = require('fs');
const path = require('path');

const CANDIDATES = [
  path.join('frontend', 'src', 'components', 'ContentCard.tsx'),
  path.join('src', 'components', 'ContentCard.tsx'),
];
const FILE = CANDIDATES.find(p => fs.existsSync(p));
if (!FILE) {
  console.error('[v77e] FATAL: ContentCard.tsx not found.');
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');
const eol = src.includes('\r\n') ? '\r\n' : '\n';
console.log('[v77e] File:', FILE);
console.log('[v77e] EOL:', eol === '\r\n' ? 'CRLF' : 'LF');

const backup = FILE + '.bak.v77e.' + Date.now();
fs.writeFileSync(backup, src);
console.log('[v77e] Backup:', backup);

let changed = false;

// ────────────────────────────────────────────────────────────
// 1) Add `useEffect` to the React hook import
// ────────────────────────────────────────────────────────────
const reactImportRe = /import\s+React\s*,\s*\{([^}]+)\}\s*from\s+['"]react['"]\s*;/;
const reactMatch = src.match(reactImportRe);
if (!reactMatch) {
  console.error('[v77e] FATAL: React import not found.');
  process.exit(1);
}
const hookList = reactMatch[1].split(',').map(s => s.trim()).filter(Boolean);
if (!hookList.includes('useEffect')) {
  hookList.push('useEffect');
  const newImport = `import React, { ${hookList.join(', ')} } from 'react';`;
  src = src.replace(reactImportRe, newImport);
  console.log('[v77e]   ✓ added useEffect to React import');
  changed = true;
} else {
  console.log('[v77e]   = useEffect already imported');
}

// ────────────────────────────────────────────────────────────
// 2) Inject the singleton batched fetcher after NO_POSTER_IMAGE
// ────────────────────────────────────────────────────────────
const BATCHER_MARK = '_v77RequestReleaseStatus';
if (!src.includes(BATCHER_MARK)) {
  const noPosterAnchor = "const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');";
  if (!src.includes(noPosterAnchor)) {
    console.error('[v77e] FATAL: NO_POSTER_IMAGE anchor not found.');
    process.exit(1);
  }
  const batcher = [
    '',
    '// === RELEASE_STATUS_V77E ===',
    '// Singleton batched fetcher. Coalesces release-status requests across all',
    '// mounted ContentCards so we send 1 batch per 250ms (up to 50 ids).',
    'const _v77ReleaseCache = new Map();',
    'const _v77PendingIds = new Set();',
    'const _v77Subscribers = new Map();',
    'let _v77FlushTimer = null;',
    '',
    'async function _v77FlushBatch() {',
    '  _v77FlushTimer = null;',
    '  if (_v77PendingIds.size === 0) return;',
    '  const ids = Array.from(_v77PendingIds).slice(0, 50);',
    '  ids.forEach(id => _v77PendingIds.delete(id));',
    '',
    '  const notifyAll = (status) => {',
    '    ids.forEach(id => {',
    '      const subs = _v77Subscribers.get(id);',
    '      if (subs) {',
    '        subs.forEach(cb => { try { cb(status); } catch (e) {} });',
    '        _v77Subscribers.delete(id);',
    '      }',
    '    });',
    '  };',
    '',
    '  try {',
    "    const backendUrl =",
    '      process.env.EXPO_PUBLIC_BACKEND_URL ||',
    '      Constants.expoConfig?.extra?.backendUrl ||',
    "      '';",
    "    const res = await fetch(`${backendUrl}/api/movie/release_status`, {",
    "      method: 'POST',",
    "      headers: { 'Content-Type': 'application/json' },",
    '      body: JSON.stringify({ imdb_ids: ids }),',
    '    });',
    '    if (!res.ok) {',
    "      notifyAll('none');",
    '    } else {',
    '      const data = await res.json();',
    '      ids.forEach(id => {',
    "        const status = (data && data[id]) || 'none';",
    '        _v77ReleaseCache.set(id, status);',
    '        const subs = _v77Subscribers.get(id);',
    '        if (subs) {',
    '          subs.forEach(cb => { try { cb(status); } catch (e) {} });',
    '          _v77Subscribers.delete(id);',
    '        }',
    '      });',
    '    }',
    '  } catch (e) {',
    "    notifyAll('none');",
    '  }',
    '',
    '  if (_v77PendingIds.size > 0 && !_v77FlushTimer) {',
    '    _v77FlushTimer = setTimeout(_v77FlushBatch, 100);',
    '  }',
    '}',
    '',
    'function _v77RequestReleaseStatus(imdbId, cb) {',
    '  if (_v77ReleaseCache.has(imdbId)) {',
    '    cb(_v77ReleaseCache.get(imdbId));',
    '    return () => {};',
    '  }',
    '  if (!_v77Subscribers.has(imdbId)) _v77Subscribers.set(imdbId, new Set());',
    '  const subs = _v77Subscribers.get(imdbId);',
    '  subs.add(cb);',
    '  _v77PendingIds.add(imdbId);',
    '  if (!_v77FlushTimer) _v77FlushTimer = setTimeout(_v77FlushBatch, 250);',
    '  return () => {',
    '    const s = _v77Subscribers.get(imdbId);',
    '    if (s) s.delete(cb);',
    '  };',
    '}',
    '',
  ].join(eol);
  src = src.replace(noPosterAnchor, noPosterAnchor + eol + batcher);
  console.log('[v77e]   ✓ batched fetcher injected');
  changed = true;
} else {
  console.log('[v77e]   = batched fetcher already present');
}

// ────────────────────────────────────────────────────────────
// 3) Add releaseStatus state + useEffect inside ContentCardComponent
// ────────────────────────────────────────────────────────────
if (!src.includes('const [releaseStatus, setReleaseStatus]')) {
  const stateAnchor = "const [useProxy, setUseProxy] = useState(false);";
  if (!src.includes(stateAnchor)) {
    console.error('[v77e] FATAL: useProxy state anchor not found.');
    process.exit(1);
  }
  const stateInject = [
    stateAnchor,
    '',
    '  const [releaseStatus, setReleaseStatus] = useState(null);',
    '',
    '  useEffect(() => {',
    '    if (!item) return;',
    "    if (item.type === 'series' || item.type === 'tv' || item.type === 'channel' || item.type === 'episode') return;",
    '    const imdbId = item.imdb_id || item.id;',
    "    if (!imdbId || !String(imdbId).startsWith('tt')) return;",
    '    return _v77RequestReleaseStatus(String(imdbId), setReleaseStatus);',
    '  }, [item]);',
  ].join(eol);
  src = src.replace(stateAnchor, stateInject);
  console.log('[v77e]   ✓ releaseStatus state + useEffect injected');
  changed = true;
} else {
  console.log('[v77e]   = releaseStatus state already present');
}

// ────────────────────────────────────────────────────────────
// 4) Inject IN CINEMAS badge JSX inside posterContainer
// ────────────────────────────────────────────────────────────
if (!src.includes("releaseStatus === 'in_cinemas'")) {
  // CRLF-safe single-line anchor — first line of the showProgress JSX block.
  const jsxAnchor = "{showProgress !== undefined &&";
  if (!src.includes(jsxAnchor)) {
    console.error('[v77e] FATAL: showProgress JSX anchor not found.');
    process.exit(1);
  }
  const badge = [
    "{releaseStatus === 'in_cinemas' && (",
    '          <View style={styles.inCinemasBadge} pointerEvents="none">',
    '            <Text style={styles.inCinemasBadgeText}>IN CINEMAS</Text>',
    '          </View>',
    '        )}',
    '',
    '        ' + jsxAnchor,
  ].join(eol);
  src = src.replace(jsxAnchor, badge);
  console.log('[v77e]   ✓ IN CINEMAS badge JSX injected');
  changed = true;
} else {
  console.log('[v77e]   = badge JSX already present');
}

if (!changed) {
  console.log('[v77e] Nothing to change. File already fully patched.');
  process.exit(0);
}

fs.writeFileSync(FILE, src);
console.log('');
console.log('[v77e] ✅ ContentCard.tsx fully patched.');
console.log('[v77e]    File:', FILE);
console.log('[v77e]    Rebuild your APK and open the app.');
console.log('[v77e]    Then verify:');
console.log("[v77e]      docker logs --tail 300 privastream-app 2>&1 | grep release_status | tail -5");
