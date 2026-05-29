/* eslint-disable */
// apply_patches_v134_overlay_and_back.js
//
// v134 frontend — three targeted fixes shipped together:
//
//   F1 (id.tsx) STUCK LOADING OVERLAY ON BACK FROM PLAYER
//       When the user clicks Play (or autoplay routes to next episode),
//       isPlayLoading / autoPlay=true causes the autoPlayOverlay to render
//       over the details page.  The details page stays MOUNTED under
//       /player, so when the user backs out of the player they return to
//       the details page with those flags still set, and see the loading
//       overlay again instead of the streams/content underneath.
//
//       Fix: extend the existing useFocusEffect so EVERY screen-focus
//       event clears isPlayLoading and (if autoPlay already fired) strips
//       the ?autoPlay=true param so the overlay can't reappear.
//
//   F2 (id.tsx) AUTOPLAY BACK HANDLER LEAVES STALE PLAYER MOUNTED
//       The autoPlay back handler does `router.replace(...)` to land on
//       the series root.  But the underlying /player(s) from the binge
//       chain stay mounted in the navigation stack -- their TVKeyEvent
//       listeners are still active and intercept D-pad on the series
//       root.  This is the "press D-pad once, screen goes back" bug.
//
//       Fix: dismiss every screen above the root tab BEFORE the replace,
//       so all binge-chain player(s)/detail pages get unmounted and their
//       useEffect cleanups run.  Stack ends at [..., RMroot].
//
//   F3 (id.tsx) BACK HANDLER DIAGNOSTICS
//       Tag every back-related code path with a console.log so the next
//       "weird back" report has a clear trail in the logcat.
//
// Pairs with patch_backend_v134_bump_budgets.py.
//
// Idempotent.  CRLF-safe.  Windows CMD:
//
//   curl -s https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v134_overlay_and_back.js -o apply_patches_v134.js && node apply_patches_v134.js
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

const idPath = find(path.join('app', 'details', '[type]', '[id].tsx'));
if (!idPath) {
  console.error('[v134] FATAL: app/details/[type]/[id].tsx not found from', process.cwd());
  process.exit(1);
}

let src = fs.readFileSync(idPath, 'utf8');
const NL = src.includes('\r\n') ? '\r\n' : '\n';
const originalLen = src.length;
const backupPath = idPath + '.bak_v134';
if (!fs.existsSync(backupPath)) {
  fs.writeFileSync(backupPath, src, 'utf8');
  console.log(`[v134] Backup: ${backupPath}`);
}

const reports = [];
function applyOnce(label, marker, oldStr, newStr) {
  if (marker && src.indexOf(marker) !== -1) {
    reports.push({ label, status: 'SKIP_IDEMPOTENT' });
    return true;
  }
  // CRLF-safe: convert LF in anchor strings to whatever the source uses.
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
// F1 — extend existing useFocusEffect to clear stuck overlay state.
// ---------------------------------------------------------------------------
const F1_OLD = `  useFocusEffect(
    useCallback(() => {
      const loadWatched = async () => {
        try {
          const data = await AsyncStorage.getItem('privastream_watched');
          if (data) setWatchedEpisodes(JSON.parse(data));
        } catch (e) {
          console.log('[DETAILS] Error loading watched data:', e);
        }
      };
      loadWatched();
    }, [])
  );`;

const F1_NEW = `  useFocusEffect(
    useCallback(() => {
      const loadWatched = async () => {
        try {
          const data = await AsyncStorage.getItem('privastream_watched');
          if (data) setWatchedEpisodes(JSON.parse(data));
        } catch (e) {
          console.log('[DETAILS] Error loading watched data:', e);
        }
      };
      loadWatched();
      /* v134-clear-overlay */
      // Returning from /player keeps this screen mounted with stale
      // isPlayLoading / autoPlay=true, leaving the loading overlay up.
      // Clear them on every focus so the user actually sees the content.
      console.log('[FOCUS v134] details focused, clearing overlay; autoPlayParam=', autoPlayParam, ' isPlayLoading-cleared');
      setIsPlayLoading(false);
      if (autoPlayTriggeredRef.current && autoPlayParam === 'true') {
        try {
          router.setParams({ autoPlay: 'done' });
          console.log('[FOCUS v134] stripped autoPlay param');
        } catch (e) {
          console.log('[FOCUS v134] setParams failed', e);
        }
      }
    }, [autoPlayParam])
  );`;

applyOnce('F1: extend useFocusEffect to clear stuck overlay', '/* v134-clear-overlay */', F1_OLD, F1_NEW);

// ---------------------------------------------------------------------------
// F2 — clean stack reset on autoPlay back handler.
// router.replace alone leaves underlying /player screens mounted in the
// stack.  Their TVKeyEvent listeners stay live and intercept D-pad on
// the series root.  Dismiss everything above the tab root first.
// ---------------------------------------------------------------------------
const F2_OLD = `  useEffect(() => {
    if (autoPlayParam !== 'true' || type !== 'series' || !baseId) return;
    const handler = () => {
      router.replace({ pathname: \`/details/series/\${baseId}\` });
      return true; // swallow the default back nav
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [autoPlayParam, type, baseId]);`;

const F2_NEW = `  useEffect(() => {
    if (autoPlayParam !== 'true' || type !== 'series' || !baseId) return;
    const handler = () => {
      /* v134-clean-stack-on-back */
      // Dismiss every screen above the tab root so leftover /player(s)
      // from the binge chain UNMOUNT and their TVKeyEvent listeners get
      // cleaned up.  Without this, D-pad presses on the series root are
      // intercepted by the still-mounted player and the screen goes back.
      console.log('[BACK v134] autoPlay back fired; dismissing stack and replacing with series root', baseId);
      try { router.dismissAll && router.dismissAll(); } catch (e) { console.log('[BACK v134] dismissAll err', e); }
      try {
        router.replace({ pathname: \`/details/series/\${baseId}\` });
      } catch (e) {
        console.log('[BACK v134] replace err', e);
      }
      return true; // swallow the default back nav
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', handler);
    return () => sub.remove();
  }, [autoPlayParam, type, baseId]);`;

applyOnce('F2: clean stack reset on autoPlay back', '/* v134-clean-stack-on-back */', F2_OLD, F2_NEW);

// ---------------------------------------------------------------------------
// F3 — diagnostic tag on the main back handler so logs make it obvious
// which handler fired.
// ---------------------------------------------------------------------------
const F3_OLD = `    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      try { if (goToSeriesRootWithFocus()) return true; } catch (_) {}
      try { router.back(); return true; } catch (_) {}
      try { router.replace('/(tabs)/discover'); } catch (_) {}
      return true;
    });`;

const F3_NEW = `    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* v134-back-diag */
      console.log('[BACK v134] main hwBack fired; id=', id, ' type=', type, ' autoPlay=', autoPlayParam);
      try { if (goToSeriesRootWithFocus()) { console.log('[BACK v134] -> series-root-with-focus'); return true; } } catch (_) {}
      try { router.back(); console.log('[BACK v134] -> router.back()'); return true; } catch (_) {}
      try { router.replace('/(tabs)/discover'); console.log('[BACK v134] -> replace discover'); } catch (_) {}
      return true;
    });`;

applyOnce('F3: diagnostic tag on main back handler', '/* v134-back-diag */', F3_OLD, F3_NEW);

const failed = reports.filter(r => r.status !== 'OK' && r.status !== 'SKIP_IDEMPOTENT');
console.log('');
console.log('[v134] === PATCH REPORT =====================================');
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
console.log('[v134] =====================================================');

if (failed.length) { console.error('[v134] Patch failed.'); process.exit(2); }
if (src.length === originalLen) { console.log('[v134] No changes.'); process.exit(0); }
fs.writeFileSync(idPath, src, 'utf8');
console.log(`[v134] Wrote ${src.length} chars (was ${originalLen}, Δ ${src.length - originalLen}).`);
console.log('[v134] Done. Rebuild + side-load.');
