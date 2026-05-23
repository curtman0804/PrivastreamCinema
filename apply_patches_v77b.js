/**
 * apply_patches_v77b.js
 * =====================
 * Adds an "IN CINEMAS" badge to ContentCard.tsx for movies that are
 * currently in theaters but NOT yet released on any streaming/digital/
 * physical/TV format (queried via the new backend /api/movie/release_status).
 *
 * Run from your frontend project root:
 *   node apply_patches_v77b.js
 *
 * Idempotent. Creates .bak.v77b.<ts> backup before editing.
 */

const fs = require('fs');
const path = require('path');

const CARD_FILE = path.join('frontend', 'src', 'components', 'ContentCard.tsx');
const MARKER = '// === RELEASE_STATUS_V77B ===';

function fail(msg) {
  console.error('[v77b] FATAL:', msg);
  process.exit(1);
}

if (!fs.existsSync(CARD_FILE)) {
  // Maybe user is already inside the frontend dir
  const alt = path.join('src', 'components', 'ContentCard.tsx');
  if (fs.existsSync(alt)) {
    runOn(alt);
  } else {
    fail(`Could not find ${CARD_FILE} or ${alt}. Run from PrivastreamCinema root.`);
  }
} else {
  runOn(CARD_FILE);
}

function runOn(file) {
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes(MARKER)) {
    console.log('[v77b] ContentCard.tsx already patched. Nothing to do.');
    process.exit(0);
  }

  const backup = file + '.bak.v77b.' + Date.now();
  fs.writeFileSync(backup, src);
  console.log('[v77b] Backup:', backup);

  // ──────────────────────────────────────────────────────────────
  // 1) Add `useEffect` to React import (if not already present)
  // ──────────────────────────────────────────────────────────────
  const reactImportRe = /import\s+React\s*,\s*\{([^}]+)\}\s*from\s*'react'\s*;/;
  const reactMatch = src.match(reactImportRe);
  if (!reactMatch) fail('Could not locate React import.');
  let hookList = reactMatch[1].split(',').map(s => s.trim()).filter(Boolean);
  if (!hookList.includes('useEffect')) {
    hookList.push('useEffect');
    const newImport = `import React, { ${hookList.join(', ')} } from 'react';`;
    src = src.replace(reactImportRe, newImport);
    console.log('[v77b] Added useEffect to React import');
  }

  // ──────────────────────────────────────────────────────────────
  // 2) Inject the singleton batched-fetcher right after NO_POSTER_IMAGE
  // ──────────────────────────────────────────────────────────────
  const anchor1 = "const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');";
  if (!src.includes(anchor1)) fail('Anchor #1 (NO_POSTER_IMAGE) not found.');

  const batcher = `

${MARKER}
// Singleton batched fetcher for /api/movie/release_status.
// Coalesces requests across all mounted ContentCards so we send 1 batch
// per 250ms (max 50 ids per batch) instead of 1 request per card.
const _v77bReleaseCache = new Map();
const _v77bPendingIds = new Set();
const _v77bSubscribers = new Map();
let _v77bFlushTimer = null;

async function _v77bFlushBatch() {
  _v77bFlushTimer = null;
  if (_v77bPendingIds.size === 0) return;
  const ids = Array.from(_v77bPendingIds).slice(0, 50);
  ids.forEach(id => _v77bPendingIds.delete(id));

  const notify = (status) => {
    ids.forEach(id => {
      const subs = _v77bSubscribers.get(id);
      if (subs) {
        subs.forEach(cb => { try { cb(status); } catch (e) {} });
        _v77bSubscribers.delete(id);
      }
    });
  };

  try {
    const backendUrl =
      process.env.EXPO_PUBLIC_BACKEND_URL ||
      Constants.expoConfig?.extra?.backendUrl ||
      '';
    const res = await fetch(\`\${backendUrl}/api/movie/release_status\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imdb_ids: ids }),
    });
    if (!res.ok) {
      notify('none');
    } else {
      const data = await res.json();
      ids.forEach(id => {
        const status = (data && data[id]) || 'none';
        _v77bReleaseCache.set(id, status);
        const subs = _v77bSubscribers.get(id);
        if (subs) {
          subs.forEach(cb => { try { cb(status); } catch (e) {} });
          _v77bSubscribers.delete(id);
        }
      });
    }
  } catch (e) {
    notify('none');
  }

  // Re-schedule if more IDs queued up while we were fetching
  if (_v77bPendingIds.size > 0 && !_v77bFlushTimer) {
    _v77bFlushTimer = setTimeout(_v77bFlushBatch, 100);
  }
}

function _v77bRequestReleaseStatus(imdbId, cb) {
  if (_v77bReleaseCache.has(imdbId)) {
    cb(_v77bReleaseCache.get(imdbId));
    return () => {};
  }
  if (!_v77bSubscribers.has(imdbId)) _v77bSubscribers.set(imdbId, new Set());
  const subs = _v77bSubscribers.get(imdbId);
  subs.add(cb);
  _v77bPendingIds.add(imdbId);
  if (!_v77bFlushTimer) _v77bFlushTimer = setTimeout(_v77bFlushBatch, 250);
  return () => {
    const s = _v77bSubscribers.get(imdbId);
    if (s) s.delete(cb);
  };
}
`;

  src = src.replace(anchor1, anchor1 + batcher);
  console.log('[v77b] Injected batched-fetcher singleton');

  // ──────────────────────────────────────────────────────────────
  // 3) Add releaseStatus state + useEffect inside ContentCardComponent
  // ──────────────────────────────────────────────────────────────
  const anchor2 = '  const [useProxy, setUseProxy] = useState(false);';
  if (!src.includes(anchor2)) fail('Anchor #2 (useProxy state) not found.');

  const stateInject = `${anchor2}

  const [releaseStatus, setReleaseStatus] = useState(null);

  useEffect(() => {
    if (!item || item.type !== 'movie') return;
    const imdbId = item.imdb_id || item.id;
    if (!imdbId || !String(imdbId).startsWith('tt')) return;
    return _v77bRequestReleaseStatus(String(imdbId), setReleaseStatus);
  }, [item]);`;
  src = src.replace(anchor2, stateInject);
  console.log('[v77b] Added releaseStatus state + useEffect');

  // ──────────────────────────────────────────────────────────────
  // 4) Inject badge JSX inside posterContainer (before progressContainer)
  // ──────────────────────────────────────────────────────────────
  const anchor3 = '        {showProgress !== undefined &&';
  if (!src.includes(anchor3)) fail('Anchor #3 (progress JSX) not found.');

  const jsxInject = `        {releaseStatus === 'in_cinemas' && (
          <View style={styles.inCinemasBadge} pointerEvents="none">
            <Text style={styles.inCinemasBadgeText}>IN CINEMAS</Text>
          </View>
        )}

` + anchor3;
  src = src.replace(anchor3, jsxInject);
  console.log('[v77b] Injected IN CINEMAS badge JSX');

  // ──────────────────────────────────────────────────────────────
  // 5) Add badge styles to StyleSheet
  // ──────────────────────────────────────────────────────────────
  const anchor4 = `  titleTV: {\n    fontSize: 13,\n  },\n});`;
  if (!src.includes(anchor4)) fail('Anchor #4 (StyleSheet end) not found.');

  const stylesInject = `  titleTV: {
    fontSize: 13,
  },

  inCinemasBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderTopLeftRadius: 3,
    borderBottomRightRadius: 6,
    zIndex: 5,
    elevation: 5,
  },

  inCinemasBadgeText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});`;
  src = src.replace(anchor4, stylesInject);
  console.log('[v77b] Added badge styles');

  fs.writeFileSync(file, src);
  console.log('');
  console.log('[v77b] ✅ ContentCard.tsx patched successfully.');
  console.log('[v77b]    File:', file);
  console.log('[v77b]    Backup:', backup);
  console.log('');
  console.log('[v77b] Next: in your Metro terminal press "r" to reload, or restart Expo.');
}
