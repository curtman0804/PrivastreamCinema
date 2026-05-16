/* eslint-disable */
// apply_patches_v55.js — Frontend half of V55 (Stremio-style two-phase discover).
//
// Pairs with patch_backend_v55.py on the VPS. Calls /api/discover?limit=5
// first for fast first paint, then fires /api/discover?skip=5 in background
// to fill in the remaining service rows. The user sees content in ~1s
// even with 30 addons.
//
// Touches frontend/src/store/contentStore.ts only.
// Backup: contentStore.ts.bak.v55.<ts>

const fs = require('fs');
const path = require('path');

const F = path.join('frontend', 'src', 'store', 'contentStore.ts');
const API_PATH_F = path.join('frontend', 'src', 'api', 'client.ts');

if (!fs.existsSync(F)) {
  console.error('ERROR: ' + F + ' not found.');
  process.exit(1);
}

let raw = fs.readFileSync(F, 'utf8');
const hadCRLF = raw.indexOf('\r\n') >= 0;
let src = raw.replace(/\r\n/g, '\n');

if (src.includes('PATCH_V55_TWO_PHASE')) {
  console.log('[OK] V55 already applied in contentStore.ts.');
  process.exit(0);
}

let fails = 0;
const ok   = (m) => console.log('  [OK]   ' + m);
const fail = (m) => { fails++; console.log('  [FAIL] ' + m); };

// Replace the fetchDiscover body with a two-phase version.
// Anchor: `  fetchDiscover: async (forceRefresh = false) => {`
const oldFetchDiscoverStart = "  fetchDiscover: async (forceRefresh = false) => {";
const oldFetchDiscoverEnd   = `  fetchAddons:`;

const startIdx = src.indexOf(oldFetchDiscoverStart);
const endIdx   = src.indexOf(oldFetchDiscoverEnd, startIdx);

if (startIdx < 0 || endIdx < 0) {
  fail('fetchDiscover block anchors not found');
} else {
  const newBody = `  // PATCH_V55_TWO_PHASE — Stremio-style two-phase discover:
  //   1) /api/discover?limit=5  (returns in ~1-2s with first 5 services)
  //   2) background /api/discover?skip=5 to fill in the rest
  fetchDiscover: async (forceRefresh = false) => {
    const currentData = get().discoverData;

    // Background background-refresh path (already have data)
    if (currentData && !forceRefresh) {
      try {
        const data: any = await (api.content as any).getDiscover();
        if (data) {
          set({ discoverData: data });
          setCache('discover_data', data, CACHE_DURATIONS.MEDIUM);
        }
      } catch (err) {
        console.log('[ContentStore] Background refresh error:', err);
      }
      return;
    }

    // First open: try local cache for instant paint
    if (!currentData && !forceRefresh) {
      const cached = await getCached<DiscoverResponse>('discover_data');
      if (cached) {
        set({ discoverData: cached, isLoadingDiscover: false });
      }
    }

    set({ isLoadingDiscover: true, error: null });
    try {
      // Phase 1 — fast first paint (5 services).
      // We fetch via api.content.getDiscover with query params appended by
      // calling client.get directly when the API allows; otherwise fall back
      // to the legacy single-call.
      let firstPage: any = null;
      try {
        // Use the underlying axios client if present
        const apiAny: any = api as any;
        if (apiAny.client && apiAny.client.get) {
          const resp = await apiAny.client.get('/discover?limit=5');
          firstPage = resp.data;
        } else {
          firstPage = await apiAny.content.getDiscover();
        }
      } catch (err) {
        // Backend might not have V55 backend yet → fall back to legacy.
        console.log('[ContentStore] Phase 1 failed, falling back:', err);
        firstPage = await (api.content as any).getDiscover();
      }

      if (firstPage) {
        set({ discoverData: firstPage, isLoadingDiscover: false });
        setCache('discover_data', firstPage, CACHE_DURATIONS.MEDIUM);

        // Phase 2 — background fill-in (rest of services) if backend says hasMore.
        const hasMore = firstPage.hasMore === true;
        const skip = (firstPage.skip || 0) + (firstPage.services ? Object.keys(firstPage.services).length : 0);
        if (hasMore && skip > 0) {
          (async () => {
            try {
              const apiAny: any = api as any;
              let restPage: any = null;
              if (apiAny.client && apiAny.client.get) {
                const resp = await apiAny.client.get('/discover?skip=' + skip);
                restPage = resp.data;
              }
              if (restPage && restPage.services) {
                const merged = {
                  ...firstPage,
                  services: { ...(firstPage.services || {}), ...(restPage.services || {}) },
                  hasMore: false,
                };
                set({ discoverData: merged });
                setCache('discover_data', merged, CACHE_DURATIONS.MEDIUM);
                console.log('[ContentStore] V55 phase-2 merged ' + Object.keys(restPage.services).length + ' more services');
              }
            } catch (e) {
              console.log('[ContentStore] V55 phase-2 background fetch failed:', e);
            }
          })();
        }
      }
    } catch (error: any) {
      console.log('[ContentStore] fetchDiscover error:', error);
      set({ error: error?.message || 'discover failed', isLoadingDiscover: false, discoverData: currentData || null });
    }
  },

  `;

  src = src.slice(0, startIdx) + newBody + src.slice(endIdx);
  ok('fetchDiscover rewritten with two-phase pattern');
}

if (fails > 0) {
  console.log('\n[FAIL] aborting — no changes saved');
  process.exit(1);
}

const bak = F + '.bak.v55.' + Date.now();
fs.copyFileSync(F, bak);
console.log('  [info] backup → ' + bak);
fs.writeFileSync(F, hadCRLF ? src.replace(/\n/g, '\r\n') : src, 'utf8');

console.log('\n========================================');
console.log('  V55 frontend done.');
console.log('========================================');
console.log('IMPORTANT: ensure patch_backend_v55.py is also applied + container');
console.log('restarted, otherwise the ?limit=5 param is ignored and behavior');
console.log('falls back to the existing single-call path (still works).');
console.log('');
console.log('Verify:');
console.log('  findstr /S /C:"PATCH_V55" frontend\\\\src\\\\store\\\\contentStore.ts');
console.log('Then rebuild APK, sideload, force-stop + relaunch.');
