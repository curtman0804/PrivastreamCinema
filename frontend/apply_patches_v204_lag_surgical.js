/*
 * apply_patches_v204_lag_surgical.js — kills the two remaining lags.
 *
 * LAG 1: Addons screen stutters after install.
 *   Chain: install → nukeDiscoverCache() sets discoverData=null (full Discover
 *   re-render #1, blank) → fetchDiscover(true) fires instantly → response lands
 *   while you're still navigating Addons → full Discover re-render #2 steals
 *   JS frames from the D-pad.
 *   Fix: install uses a SOFT nuke (keeps current posters on screen — no blank,
 *   no re-render #1) and the heavy refetch is deferred behind
 *   InteractionManager so D-pad events win. Uninstall keeps the HARD nuke
 *   (posters vanish instantly — that behaviour is correct and liked).
 *
 * LAG 2: Back from Details → Discover stutters.
 *   Chain: focus effect refetches discover + CW after the throttle window →
 *   responses are new object references even when the content is IDENTICAL →
 *   flatRowsV54 memo recomputes → every row + hundreds of posters re-render.
 *   Fix: V204_SKIP_IDENTICAL — if the fresh payload deep-equals the current
 *   one, keep the SAME reference. Memos don't recompute, rows don't re-render,
 *   back-nav stays glued to 60fps. Same trick for Continue Watching. Also the
 *   disk persist (big JSON.stringify) is deferred off the critical frame.
 *
 * Idempotent (V204 markers). CRLF-safe. Backs up each file once (.v204.bak).
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   node apply_patches_v204_lag_surgical.js
 *   npx expo run:android --device
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
function find(c){for(const p of c){const f=path.join(ROOT,...p);if(fs.existsSync(f))return f}return null}
const storeFile    = find([['src','store','contentStore.ts'],['src','stores','contentStore.ts']]);
const addonsFile   = find([['app','(tabs)','addons.tsx'],['app','addons.tsx']]);
const discoverFile = find([['app','(tabs)','discover.tsx'],['app','discover.tsx']]);
if (!storeFile || !addonsFile || !discoverFile) {
  console.error('[v204] FATAL: files not found', { storeFile, addonsFile, discoverFile });
  process.exit(1);
}

function read(file){
  const raw = fs.readFileSync(file,'utf8');
  const eol = raw.indexOf('\r\n')!==-1?'crlf':'lf';
  return { raw, eol, text: eol==='crlf' ? raw.replace(/\r\n/g,'\n') : raw };
}
function write(file, st, tag){
  const bak = file + '.v204.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, st.raw, 'utf8');
  fs.writeFileSync(file, st.eol==='crlf' ? st.text.replace(/\n/g,'\r\n') : st.text, 'utf8');
  console.log(`[v204] ${path.basename(file)}: ${tag}`);
}

let applied = 0, skipped = 0, failed = 0;
function expect(cond, msg){ if (!cond) { console.error('[v204] FATAL: ' + msg); failed++; } return cond; }

// ────────────────────────────────────────────────────────────────
// PATCH 1+2 — contentStore.ts: soft nuke + skip-identical discover set
// ────────────────────────────────────────────────────────────────
{
  const st = read(storeFile);
  if (st.text.indexOf('V204_SOFT_NUKE') !== -1) {
    console.log('[v204] contentStore.ts: already applied'); skipped++;
  } else {
    let ok = true;

    // 1a. soft-mode nuke
    const nukeOld = `  nukeDiscoverCache: async () => {
    try { set({ discoverData: null, isLoadingDiscover: false, discoverNukeStamp: Date.now() } as any); } catch (_) {}`;
    const nukeNew = `  nukeDiscoverCache: async (soft = false) => {
    // V204_SOFT_NUKE — soft keeps current posters on screen (no blank flash, no
    // extra Discover re-render while the user is on Addons); fresh data simply
    // replaces them when the forced refetch lands.
    try {
      if (soft) set({ discoverNukeStamp: Date.now() } as any);
      else set({ discoverData: null, isLoadingDiscover: false, discoverNukeStamp: Date.now() } as any);
    } catch (_) {}`;
    ok = expect(st.text.indexOf(nukeOld) !== -1, 'nukeDiscoverCache v199 body not found in contentStore') && ok;

    // 1b. interface: () => Promise<void>  ->  (soft?: boolean) => Promise<void>
    const ifaceOld = `  // V199_TRUE_WIPE
  nukeDiscoverCache: () => Promise<void>;`;
    const ifaceNew = `  // V199_TRUE_WIPE / V204_SOFT_NUKE
  nukeDiscoverCache: (soft?: boolean) => Promise<void>;`;
    ok = expect(st.text.indexOf(ifaceOld) !== -1, 'nukeDiscoverCache interface line not found') && ok;

    // 2a. background-refresh path: skip set when payload identical
    const bgOld = `        const data: any = await (api.content as any).getDiscover();
        if (data) {
          set({ discoverData: data });
          setCache('discover_data', data, CACHE_DURATIONS.MEDIUM);
        }`;
    const bgNew = `        const data: any = await (api.content as any).getDiscover();
        if (data) {
          // V204_SKIP_IDENTICAL — same payload => keep the same object reference
          // so flatRows memos don't recompute and no row re-renders (this was
          // the post-back-nav D-pad freeze).
          try {
            const prev = get().discoverData;
            if (prev && JSON.stringify(prev) === JSON.stringify(data)) return;
          } catch (_) {}
          set({ discoverData: data });
          setCache('discover_data', data, CACHE_DURATIONS.MEDIUM);
        }`;
    ok = expect(st.text.indexOf(bgOld) !== -1, 'background-refresh block not found in fetchDiscover') && ok;

    // 2b. main fetch path: skip set when payload identical
    const mainOld = `      if (firstPage) {
        set({ discoverData: firstPage, isLoadingDiscover: false });
        setCache('discover_data', firstPage, CACHE_DURATIONS.MEDIUM);
}`;
    const mainNew = `      if (firstPage) {
        let identical = false; // V204_SKIP_IDENTICAL
        try {
          const prev = get().discoverData;
          identical = !!prev && JSON.stringify(prev) === JSON.stringify(firstPage);
        } catch (_) {}
        if (identical) {
          set({ isLoadingDiscover: false });
        } else {
          set({ discoverData: firstPage, isLoadingDiscover: false });
          setCache('discover_data', firstPage, CACHE_DURATIONS.MEDIUM);
        }
}`;
    ok = expect(st.text.indexOf(mainOld) !== -1, 'main fetch block not found in fetchDiscover') && ok;

    if (ok) {
      st.text = st.text.replace(nukeOld, nukeNew).replace(ifaceOld, ifaceNew)
                       .replace(bgOld, bgNew).replace(mainOld, mainNew);
      write(storeFile, st, 'soft nuke + skip-identical discover updates');
      applied++;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH 3 — addons.tsx: soft nuke on install, deferred refetch on all paths
// ────────────────────────────────────────────────────────────────
{
  const st = read(addonsFile);
  if (st.text.indexOf('V204_SOFT_REFRESH') !== -1) {
    console.log('[v204] addons.tsx: already applied'); skipped++;
  } else {
    let ok = true;

    // 3a. import InteractionManager
    const impOld = `  Share,
  useWindowDimensions,
} from 'react-native';`;
    const impNew = `  Share,
  useWindowDimensions,
  InteractionManager,
} from 'react-native';`;
    ok = expect(st.text.indexOf(impOld) !== -1, 'react-native import block not found in addons.tsx') && ok;

    // 3b. UNINSTALL block (target via the unique preceding api call): HARD nuke, deferred fetch
    const unOld = `              await api.addons.uninstall(addon.id);
              // V199_TRUE_WIPE — wipe ALL frontend discover caches before re-fetching
      try { await (useContentStore.getState() as any).nukeDiscoverCache?.(); } catch (_) {}
      await fetchAddons(true);
      fetchDiscover(true);`;
    const unNew = `              await api.addons.uninstall(addon.id);
              // V204_HARD_REFRESH — uninstall: posters vanish instantly, heavy
              // refetch deferred so the Addons screen stays responsive.
              try { await (useContentStore.getState() as any).nukeDiscoverCache?.(); } catch (_) {}
              await fetchAddons(true);
              InteractionManager.runAfterInteractions(() => { fetchDiscover(true); });`;
    ok = expect(st.text.indexOf(unOld) !== -1, 'uninstall v199 block not found in addons.tsx') && ok;

    if (ok) {
      st.text = st.text.replace(impOld, impNew).replace(unOld, unNew);

      // 3c. remaining (install) blocks: SOFT nuke + deferred fetch
      const instOld = `      // V199_TRUE_WIPE — wipe ALL frontend discover caches before re-fetching
      try { await (useContentStore.getState() as any).nukeDiscoverCache?.(); } catch (_) {}
      await fetchAddons(true);
      fetchDiscover(true);`;
      const instNew = `      // V204_SOFT_REFRESH — install: keep posters on screen (soft nuke) and
      // defer the heavy refetch until D-pad interactions settle.
      try { await (useContentStore.getState() as any).nukeDiscoverCache?.(true); } catch (_) {}
      await fetchAddons(true);
      InteractionManager.runAfterInteractions(() => { fetchDiscover(true); });`;
      const count = st.text.split(instOld).length - 1;
      if (!expect(count >= 1, `expected >=1 install block, found ${count}`)) {
        // continue anyway — uninstall fix is already in
      } else {
        st.text = st.text.split(instOld).join(instNew);
      }
      write(addonsFile, st, `hard-refresh uninstall + soft-refresh ${count} install path(s), all deferred`);
      applied++;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH 4 — discover.tsx: skip-identical CW + deferred disk persist
// ────────────────────────────────────────────────────────────────
{
  const st = read(discoverFile);
  if (st.text.indexOf('V204_SKIP_IDENTICAL') !== -1) {
    console.log('[v204] discover.tsx: already applied'); skipped++;
  } else {
    let ok = true;

    const cwOld = `      const response = await api.watchProgress.getAll();
      setContinueWatching(response.continueWatching || []);
      lastCWFetchTime.current = Date.now();`;
    const cwNew = `      const response = await api.watchProgress.getAll();
      const _v204Next = response.continueWatching || [];
      // V204_SKIP_IDENTICAL — unchanged CW => keep previous array reference (no re-render)
      setContinueWatching(prev => {
        try { if (JSON.stringify(prev) === JSON.stringify(_v204Next)) return prev; } catch (_) {}
        return _v204Next;
      });
      lastCWFetchTime.current = Date.now();`;
    ok = expect(st.text.indexOf(cwOld) !== -1, 'fetchContinueWatching block not found in discover.tsx') && ok;

    const perOld = `  useEffect(() => {
    if (discoverData?.services) {
      try {
        AsyncStorage.setItem('@ps_discover_v1', JSON.stringify(discoverData)).catch(() => {});
      } catch (_) {}
    }
  }, [discoverData]);`;
    const perNew = `  useEffect(() => {
    if (!discoverData?.services) return;
    // V204_DEFER_PERSIST — big JSON.stringify + disk write off the critical frame
    const h = InteractionManager.runAfterInteractions(() => {
      try {
        AsyncStorage.setItem('@ps_discover_v1', JSON.stringify(discoverData)).catch(() => {});
      } catch (_) {}
    });
    return () => { try { h.cancel(); } catch (_) {} };
  }, [discoverData]);`;
    ok = expect(st.text.indexOf(perOld) !== -1, 'V144 persist effect not found in discover.tsx') && ok;

    if (ok) {
      st.text = st.text.replace(cwOld, cwNew).replace(perOld, perNew);
      write(discoverFile, st, 'skip-identical CW + deferred persist');
      applied++;
    }
  }
}

console.log('');
console.log(`[v204] Summary: ${applied} applied, ${skipped} skipped/already, ${failed} failed.`);
if (failed > 0) process.exit(2);
console.log('');
console.log('[v204] Done. Next:');
console.log('  npx expo run:android --device');
console.log('');
console.log('Test 1: install an addon, keep navigating the Addons screen — no stutter;');
console.log('        go to Discover — old posters still there, new rows pop in when ready.');
console.log('Test 2: open a movie Details page, press Back — Discover responds instantly.');
console.log('Test 3: uninstall an addon — its posters still vanish in seconds.');
