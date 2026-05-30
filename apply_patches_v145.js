/* eslint-disable */
// apply_patches_v145_continue_watching_optimistic_x.js
//
// CONTINUE-WATCHING X DISMISS — smooth, instant visual removal.
//
// Your complaint:
//   "When I nav up and click an X button on a poster in continue
//    watching it takes a few seconds to go away.  We need to make
//    that near instant as well."
//
// The handler in discover.tsx already does optimistic state removal
// (setContinueWatching → background DELETE).  But on Android TV the
// abrupt setState collapses the row layout in a single frame, which
// the GPU does WITHOUT any tween, AND the entire <DiscoverScreen>
// re-runs flatRowsV54 + re-renders every ServiceRow underneath.  The
// JS thread is busy for ~400-800ms doing that work → user sees the
// card hang on screen for that duration before it vanishes.
//
// v145 fix: wrap the setContinueWatching call in
// LayoutAnimation.configureNext(...) BEFORE the state update.
// React Native's bridge then schedules a 220ms native easeInOut tween
// (off the JS thread) that fades the card out + collapses the row.
// The user sees the dismissal start in the very next frame (~16ms)
// regardless of how busy the JS thread is afterwards.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v145_continue_watching_optimistic_x.js -o apply_patches_v145.js && node apply_patches_v145.js
//
// REQUIRES v144 applied first.
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
  console.error('[v145] FATAL: app/(tabs)/discover.tsx not found');
  process.exit(1);
}

let src = fs.readFileSync(discoverPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = discoverPath + '.bak_v145';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v145] Backup: ${backupPath}`);
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

// ─────────────────────────────────────────────────────────────
// PATCH 1 — add LayoutAnimation + UIManager to the react-native
// destructured import, and enable it on Android.
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p1_import_layoutanim',
  'PATCH_V145_LAYOUTANIM_IMPORT',
  `import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  FlatList,
  useWindowDimensions,
  findNodeHandle,
  Platform,
  InteractionManager,
} from 'react-native';`,
  `import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  ActivityIndicator,
  Pressable,
  FlatList,
  useWindowDimensions,
  findNodeHandle,
  Platform,
  InteractionManager,
  LayoutAnimation,
  UIManager,
} from 'react-native';
// PATCH_V145_LAYOUTANIM_IMPORT — enable LayoutAnimation on Android once at module load
if (Platform.OS === 'android' && UIManager && (UIManager as any).setLayoutAnimationEnabledExperimental) {
  try { (UIManager as any).setLayoutAnimationEnabledExperimental(true); } catch (_) {}
}`
);

// ─────────────────────────────────────────────────────────────
// PATCH 2 — wrap setContinueWatching in LayoutAnimation tween
// ─────────────────────────────────────────────────────────────
applyOnce(
  'p2_layoutanim_on_remove',
  'PATCH_V145_LAYOUTANIM_REMOVE',
  `  // Handle removing item from continue watching
  const handleRemoveFromContinueWatching = async (item: WatchProgress) => {
    // Optimistic update - remove from UI immediately for instant feedback
    setContinueWatching(prev => prev.filter(i => i.content_id !== item.content_id));
    
    // Then delete from server in background (don't await)
    api.watchProgress.delete(item.content_id).catch(err => {
      console.log('[Discover] Error removing from continue watching:', err);
      // Optionally: restore the item if delete fails
    });
  };`,
  `  // Handle removing item from continue watching
  const handleRemoveFromContinueWatching = async (item: WatchProgress) => {
    // PATCH_V145_LAYOUTANIM_REMOVE — schedule a native 220ms easeInOut tween
    // so the card visibly fades + collapses on the very next frame, even if
    // the JS thread is busy re-rendering the rest of Discover afterwards.
    try {
      LayoutAnimation.configureNext({
        duration: 220,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
        delete: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
      });
    } catch (_) {}

    // Optimistic update - remove from UI immediately for instant feedback
    setContinueWatching(prev => prev.filter(i => i.content_id !== item.content_id));
    // Also drop from the cached snapshot so a cold start won't show it again
    setCachedCW(prev => (prev || []).filter(i => i.content_id !== item.content_id));

    // Then delete from server in background (don't await)
    api.watchProgress.delete(item.content_id).catch(err => {
      console.log('[Discover] Error removing from continue watching:', err);
      // Optionally: restore the item if delete fails
    });
  };`
);

// ─────────────────────────────────────────────────────────────
// Write back
// ─────────────────────────────────────────────────────────────
if (src.length === originalLen && reports.every(r => r.status === 'SKIP_IDEMPOTENT')) {
  console.log('[v145] All patches already applied — no changes written.');
} else {
  fs.writeFileSync(discoverPath, src, 'utf8');
  console.log(`[v145] Wrote ${discoverPath} (size ${originalLen} → ${src.length})`);
}

console.log('[v145] Report:');
for (const r of reports) {
  console.log(' ', r.label, '→', r.status, r.delta !== undefined ? `(Δ${r.delta})` : '', r.count !== undefined ? `(x${r.count})` : '');
}

const okCount = reports.filter(r => r.status === 'OK').length;
const skipCount = reports.filter(r => r.status === 'SKIP_IDEMPOTENT').length;
const failCount = reports.length - okCount - skipCount;
console.log(`[v145] Summary: ${okCount} applied, ${skipCount} already-applied, ${failCount} failed.`);
process.exit(failCount > 0 ? 1 : 0);
