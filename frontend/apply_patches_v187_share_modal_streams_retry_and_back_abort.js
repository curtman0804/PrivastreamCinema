/*
 * apply_patches_v187_share_modal_streams_retry_and_back_abort.js
 *
 * V187 — Frontend bundle (3 files):
 *   A. addons.tsx        → Themed Share dialog (custom Modal, dark/gold theme)
 *   B. contentStore.ts   → Cancel-on-unmount + auto-retry-on-empty for streams
 *   C. details/[type]/[id].tsx → call cancelInFlightStreams on Back press
 *
 * Goals (from user feedback):
 *   1. Share dialog now matches app theme (no more native Alert).
 *   2. Back-nav lag from Details → kill any in-flight stream fetch so the
 *      JS thread is free when Discover takes focus again.
 *   3. Stream cards populate reliably — if the first response has 0
 *      streams (cold backend, Torrentio slow through Cloudflare), fire
 *      one auto-retry after 3 s.  By that time the v187 backend SWR
 *      task should have warmed the Redis cache → instant cache-hit.
 *
 * Properties:
 *   - Idempotent (markers V187_SHARE_MODAL + V187_STREAMS_RETRY +
 *     V187_CANCEL_ON_BACK)
 *   - CRLF preserved per file
 *   - Backups: .v187.bak on each
 *
 * Usage (Windows CMD)
 * -------------------
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v187_share_modal_streams_retry_and_back_abort.js -o apply_patches_v187_share_modal_streams_retry_and_back_abort.js
 *   node apply_patches_v187_share_modal_streams_retry_and_back_abort.js
 *
 * Then rebuild & sideload:
 *   npx expo run:android --device
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
function find(cands) {
  for (const c of cands) {
    const p = path.join(ROOT, ...c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const addonsFile = find([
  ['app', '(tabs)', 'addons.tsx'],
  ['app', 'addons.tsx'],
  ['app', 'settings', 'addons.tsx'],
]);
const storeFile = find([
  ['src', 'store', 'contentStore.ts'],
  ['src', 'stores', 'contentStore.ts'],
  ['store', 'contentStore.ts'],
]);
const detailsFile = find([
  ['app', 'details', '[type]', '[id].tsx'],
  ['app', '(tabs)', 'details', '[type]', '[id].tsx'],
  ['app', 'details', '[id].tsx'],
]);

if (!addonsFile)  { console.error('[v187] FATAL: addons.tsx not found.');  process.exit(1); }
if (!storeFile)   { console.error('[v187] FATAL: contentStore.ts not found.'); process.exit(1); }
if (!detailsFile) { console.error('[v187] FATAL: details/[type]/[id].tsx not found.'); process.exit(1); }

console.log('[v187] addons:  ', path.relative(ROOT, addonsFile));
console.log('[v187] store:   ', path.relative(ROOT, storeFile));
console.log('[v187] details: ', path.relative(ROOT, detailsFile));

function patchFile(file, marker, edits) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;
  if (text.indexOf(marker) !== -1) {
    console.log(`[v187] ${path.basename(file)}: already patched (${marker}), skipping.`);
    return;
  }
  for (const e of edits) {
    if (text.indexOf(e.old) === -1) {
      console.error(`[v187] FATAL anchor missed in ${path.basename(file)}: ${e.label}`);
      console.error(`        looked for:\n${e.old.slice(0, 200)}...`);
      process.exit(2);
    }
    text = text.replace(e.old, e.new, 1);
    console.log(`[v187] ${path.basename(file)}: ${e.label}`);
  }
  const bak = file + '.v187.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[v187] wrote ${path.relative(ROOT, file)} (${eol.toUpperCase()}, backup=.v187.bak)`);
}

// ════════════════════════════════════════════════════════════════════════
// A. addons.tsx — replace Alert-based share with themed Modal
// ════════════════════════════════════════════════════════════════════════
//
// We replace the v186 `handleShareAddon` (which calls Alert.alert) with:
//   - state: shareModalData (null | { name, url, code })
//   - handleShareAddon now just opens the modal
//   - new <Modal> rendered next to the existing Install <Modal> using the
//     SAME modalContent/modalTitle/modalButton styles → free theme match
//   - new handleShareConfirm uses Share.share with formatted message

const addonsOldHandleShare = `  // V186_SHARE_CODES — share both the FireStick Downloader code (if known)
  // and the manifest URL.  Codes are matched against addon name + URL so
  // the lookup survives custom installs (e.g. Torrentio + PM apikey).
  const _v186DownloaderCodeFor = (name: string, url: string): string | null => {
    const n = (name || '').toLowerCase();
    const u = (url || '').toLowerCase();
    // Cinemeta — official Stremio metadata addon
    if (n.includes('cinemeta') || u.includes('cinemeta.strem.io')) return '8762337';
    // Netflix catalog addon
    if (n.includes('netflix') || u.includes('netflix')) return '201839';
    // Torrentio (any configuration: free, real-debrid, premiumize, etc.)
    if (n.includes('torrentio') || u.includes('torrentio.strem')) return '2519255';
    // The Pirate Bay addon (a.k.a. tpb / piratebay)
    if (n.includes('pirate') || n === 'tpb' || u.includes('piratebay') || u.includes('tpb.strem') || u.includes('thepiratebay')) return '970280';
    return null;
  };
  const handleShareAddon = async (addon: Addon) => {
    const addonUrl = (addon as any).manifestUrl || addon.url || '';
    const addonName = addon.manifest?.name || 'Addon';

    if (!addonUrl) {
      Alert.alert('No URL', 'This addon does not have a shareable URL.');
      return;
    }

    const code = _v186DownloaderCodeFor(addonName, addonUrl);
    const codeLine = code ? \`Downloader Code: \${code}\\n\` : '';
    const alertBody = code
      ? \`Downloader Code: \${code}\\n\\n\${addonUrl}\`
      : addonUrl;
    const shareMessage = code
      ? \`\${addonName}\\n\\nDownloader Code: \${code}\\nManifest URL: \${addonUrl}\`
      : \`Check out this Stremio addon: \${addonName}\\n\\n\${addonUrl}\`;

    Alert.alert(
      \`Share \${addonName}\`,
      alertBody,
      [
        { text: 'Copy & Share', onPress: async () => {
          try {
            await Share.share({
              message: shareMessage,
              title: \`Share \${addonName} Addon\`,
            });
          } catch (error) {
            console.log('Share error:', error);
          }
        }},
        { text: 'OK', style: 'cancel' },
      ]
    );
  };`;

const addonsNewHandleShare = `  // V187_SHARE_MODAL — themed dialog (no more native Alert).
  // Downloader-code map (from v186, preserved):
  const _v186DownloaderCodeFor = (name: string, url: string): string | null => {
    const n = (name || '').toLowerCase();
    const u = (url || '').toLowerCase();
    if (n.includes('cinemeta') || u.includes('cinemeta.strem.io')) return '8762337';
    if (n.includes('netflix') || u.includes('netflix')) return '201839';
    if (n.includes('torrentio') || u.includes('torrentio.strem')) return '2519255';
    if (n.includes('pirate') || n === 'tpb' || u.includes('piratebay') || u.includes('tpb.strem') || u.includes('thepiratebay')) return '970280';
    return null;
  };
  const handleShareAddon = (addon: Addon) => {
    const addonUrl = (addon as any).manifestUrl || addon.url || '';
    const addonName = addon.manifest?.name || 'Addon';
    if (!addonUrl) {
      Alert.alert('No URL', 'This addon does not have a shareable URL.');
      return;
    }
    const code = _v186DownloaderCodeFor(addonName, addonUrl);
    setShareModalData({ name: addonName, url: addonUrl, code });
  };
  const handleShareConfirm = async () => {
    if (!shareModalData) return;
    const { name, url, code } = shareModalData;
    const shareMessage = code
      ? \`\${name}\\n\\nDownloader Code: \${code}\\nManifest URL: \${url}\`
      : \`Check out this Stremio addon: \${name}\\n\\n\${url}\`;
    try {
      await Share.share({ message: shareMessage, title: \`Share \${name} Addon\` });
    } catch (error) {
      console.log('Share error:', error);
    } finally {
      setShareModalData(null);
    }
  };`;

// Add the shareModalData state declaration & focus states next to the
// existing state declarations.  Anchor: existing `[codeTabFocused, ...]`.
const addonsOldState = `  const [urlTabFocused, setUrlTabFocused] = useState(false);
  const [codeTabFocused, setCodeTabFocused] = useState(false);`;
const addonsNewState = `  const [urlTabFocused, setUrlTabFocused] = useState(false);
  const [codeTabFocused, setCodeTabFocused] = useState(false);
  // V187_SHARE_MODAL — themed dialog state + focus tracking
  const [shareModalData, setShareModalData] = useState<{ name: string; url: string; code: string | null } | null>(null);
  const [shareCopyFocused, setShareCopyFocused] = useState(false);
  const [shareCloseFocused, setShareCloseFocused] = useState(false);`;

// Add the share modal JSX right BEFORE the closing </SafeAreaView>.
// Anchor: the existing Install Modal's </Modal> + </SafeAreaView>.
const addonsOldModalClose = `        </View>
      </Modal>
    </SafeAreaView>
  );
}`;
const addonsNewModalClose = `        </View>
      </Modal>

      {/* V187_SHARE_MODAL — themed Share dialog (dark/gold like the rest of the app) */}
      <Modal
        visible={shareModalData != null}
        animationType="fade"
        transparent={true}
        onRequestClose={() => setShareModalData(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, isTV && styles.modalContentTV, { borderWidth: 2, borderColor: colors.primary }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Share {shareModalData?.name || 'Addon'}</Text>
              <Pressable onPress={() => setShareModalData(null)} style={styles.actionButton}>
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            {shareModalData?.code ? (
              <>
                <Text style={styles.modalLabel}>Downloader Code</Text>
                <View style={[styles.modalInput, { minHeight: 0, paddingVertical: 16 }]}>
                  <Text style={{ color: colors.primary, fontSize: 24, fontWeight: '700', letterSpacing: 2, textAlign: 'center' }}>
                    {shareModalData.code}
                  </Text>
                </View>
                <View style={{ height: 12 }} />
              </>
            ) : null}

            <Text style={styles.modalLabel}>Manifest URL</Text>
            <View style={[styles.modalInput, { minHeight: 0, paddingVertical: 14 }]}>
              <Text style={{ color: '#FFFFFF', fontSize: 13 }} selectable={true}>
                {shareModalData?.url || ''}
              </Text>
            </View>
            <Text style={styles.modalHint}>
              {shareModalData?.code
                ? 'Recipient can enter the Downloader code on FireStick or paste the URL into Stremio.'
                : 'Recipient can paste the manifest URL into Stremio to install this addon.'}
            </Text>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Pressable
                onPress={handleShareConfirm}
                onFocus={() => setShareCopyFocused(true)}
                onBlur={() => setShareCopyFocused(false)}
                style={[styles.modalButton, { flex: 1 }, shareCopyFocused && styles.modalButtonFocused]}
              >
                <View style={styles.buttonRow}>
                  <Ionicons name="share-outline" size={18} color={colors.primary} />
                  <Text style={[styles.modalButtonText, { marginLeft: 8 }]}>Copy & Share</Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => setShareModalData(null)}
                onFocus={() => setShareCloseFocused(true)}
                onBlur={() => setShareCloseFocused(false)}
                style={[styles.modalButton, { flex: 1, backgroundColor: '#2A2A2E' }, shareCloseFocused && styles.modalButtonFocused]}
              >
                <Text style={[styles.modalButtonText, { color: '#AAAAAA' }]}>Close</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}`;

patchFile(addonsFile, 'V187_SHARE_MODAL', [
  { label: 'A1. add shareModalData state',  old: addonsOldState,        new: addonsNewState        },
  { label: 'A2. handleShareAddon → modal',  old: addonsOldHandleShare,  new: addonsNewHandleShare  },
  { label: 'A3. mount themed Share modal',  old: addonsOldModalClose,   new: addonsNewModalClose   },
]);

// ════════════════════════════════════════════════════════════════════════
// B. contentStore.ts — cancel-on-unmount + auto-retry-on-empty
// ════════════════════════════════════════════════════════════════════════

// Add a module-scope abort token + a `cancelInFlightStreams` function.
// Anchor: the existing module-scope `const _pendingPrefetches = new Map...`
// line — they live in the same neighborhood.

const storeOldAbort = `const _pendingPrefetches = new Map<string, Promise<Stream[]>>();`;
const storeNewAbort = `const _pendingPrefetches = new Map<string, Promise<Stream[]>>();
// V187_STREAMS_RETRY — abort token incremented every time the user leaves
// a Details page.  fetchStreams compares the token before each set() — if
// it changed, the result is dropped (keeps the JS thread idle right after
// back-nav so the previous screen can paint immediately).
let _v187AbortToken = 0;`;

// Wire `cancelInFlightStreams` into the store interface.
// Add the declaration to the interface (next to the existing
// fetchStreams declaration).
const storeOldInterface = `  fetchStreams: (type: string, id: string) => Promise<Stream[]>;`;
const storeNewInterface = `  fetchStreams: (type: string, id: string) => Promise<Stream[]>;
  // V187_STREAMS_RETRY
  cancelInFlightStreams: () => void;`;

// Replace fetchStreams body to:
//  - capture _v187AbortToken at the start
//  - on every set() check token; bail out if changed
//  - if final result has 0 streams, fire a single retry after 3 s
//
// Anchor: the entire current fetchStreams body (matches V19B + V170B markers).
const storeOldFetchStreams = `  fetchStreams: async (type: string, id: string) => {
    // PATCH_V19B_FETCHSTREAMS_BODY — memory cache → disk cache → network
    const cacheKey = \`\${type}/\${id}\`;

    // 1. Memory cache — instant
    const cached = getStreamsCache(cacheKey);
    if (cached && cached.length > 0) {
      set({ streams: cached, isLoadingStreams: false, error: null });
      return cached;
    }

    // 2. AsyncStorage disk cache — ~10ms
    set({ isLoadingStreams: true, streams: [], error: null });
    // PATCH_V46_WATCHDOG — force-clear isLoadingStreams if fetchStreams hangs >30s.
    // The if-guard makes this a no-op in the happy path; no cleanup needed.
    setTimeout(() => {
      if (get().isLoadingStreams) {
        console.log('[ContentStore] V46 watchdog fired — clearing stuck isLoadingStreams after 30s');
        set({ isLoadingStreams: false, error: null });
      }
    }, 30000);
    const diskCached = await loadStreamsFromDisk(cacheKey);
    if (diskCached && diskCached.length > 0) {
      setStreamsCache(cacheKey, diskCached);
      set({ streams: diskCached, isLoadingStreams: false, error: null });
      return diskCached;
    }

    /* V170B_FETCH_SHARES_PREFETCH — if a focus-prefetch is already in
       flight for this content, await ITS promise instead of firing a
       parallel duplicate fetch.  This kills the "2 streams -> 8" race
       that progressive-paint partial results from the second fetch
       caused before they merged. */
    const _v170bInflight = _pendingPrefetches.get(cacheKey);
    if (_v170bInflight) {
      try {
        const shared = await _v170bInflight;
        if (shared && shared.length > 0) {
          setStreamsCache(cacheKey, shared);
          set({ streams: shared, isLoadingStreams: false, error: null });
          return shared;
        }
      } catch (_) { /* fall through to a fresh fetch */ }
    }

    // 3. Network -- single final set, no progressive paint (V170B_NO_PARTIAL_PAINT)
    try {
      /* V170B_NO_PARTIAL_PAINT — no progressive callback.  Await the
         full merged result and paint once.  Trade-off: cold-cache users
         see "Finding Streams..." until ALL sources complete (typically
         1.5-3 s) but the count never flickers between intermediate
         values.  Focus-prefetch (v169) carries most clicks anyway, so
         in practice the spinner is rare. */
      const result = await api.addons.getAllStreams(type, id);
      const allStreams = result.streams || [];
      setStreamsCache(cacheKey, allStreams);
      saveStreamsToDisk(cacheKey, allStreams); // fire-and-forget
      set({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore] fetchStreams error:', error);
      set({ streams: [], isLoadingStreams: false });
      return [];
    }
  },`;

const storeNewFetchStreams = `  fetchStreams: async (type: string, id: string) => {
    // V187_STREAMS_RETRY — snapshot abort token at call time
    const _myToken = _v187AbortToken;
    const _setIfActive = (patch: any) => { if (_myToken === _v187AbortToken) set(patch); };

    // PATCH_V19B_FETCHSTREAMS_BODY — memory cache → disk cache → network
    const cacheKey = \`\${type}/\${id}\`;

    // 1. Memory cache — instant
    const cached = getStreamsCache(cacheKey);
    if (cached && cached.length > 0) {
      _setIfActive({ streams: cached, isLoadingStreams: false, error: null });
      return cached;
    }

    // 2. AsyncStorage disk cache — ~10ms
    _setIfActive({ isLoadingStreams: true, streams: [], error: null });
    setTimeout(() => {
      if (get().isLoadingStreams && _myToken === _v187AbortToken) {
        console.log('[ContentStore] V46 watchdog fired — clearing stuck isLoadingStreams after 30s');
        _setIfActive({ isLoadingStreams: false, error: null });
      }
    }, 30000);
    const diskCached = await loadStreamsFromDisk(cacheKey);
    if (diskCached && diskCached.length > 0) {
      setStreamsCache(cacheKey, diskCached);
      _setIfActive({ streams: diskCached, isLoadingStreams: false, error: null });
      return diskCached;
    }

    /* V170B_FETCH_SHARES_PREFETCH — share in-flight prefetch promise */
    const _v170bInflight = _pendingPrefetches.get(cacheKey);
    if (_v170bInflight) {
      try {
        const shared = await _v170bInflight;
        if (shared && shared.length > 0) {
          setStreamsCache(cacheKey, shared);
          _setIfActive({ streams: shared, isLoadingStreams: false, error: null });
          return shared;
        }
      } catch (_) { /* fall through to a fresh fetch */ }
    }

    // 3. Network
    try {
      const result = await api.addons.getAllStreams(type, id);
      let allStreams = result.streams || [];

      // V187_STREAMS_RETRY — if the first call returned empty, the backend's
      // SWR refresh task is still finishing.  Wait 3 s and try once more —
      // by then Redis is warm and the second call is an instant cache hit.
      if ((!allStreams || allStreams.length === 0) && _myToken === _v187AbortToken) {
        console.log('[ContentStore v187] 0 streams on first try — retrying once in 3s');
        await new Promise((r) => setTimeout(r, 3000));
        if (_myToken !== _v187AbortToken) {
          // User navigated away — abort, do NOT update state
          return [];
        }
        try {
          const retry = await api.addons.getAllStreams(type, id);
          if (retry && retry.streams && retry.streams.length > 0) {
            allStreams = retry.streams;
            console.log('[ContentStore v187] retry succeeded:', allStreams.length, 'streams');
          } else {
            console.log('[ContentStore v187] retry also returned 0');
          }
        } catch (e) {
          console.log('[ContentStore v187] retry threw:', e);
        }
      }

      if (allStreams.length > 0) {
        setStreamsCache(cacheKey, allStreams);
        saveStreamsToDisk(cacheKey, allStreams);
      }
      _setIfActive({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore] fetchStreams error:', error);
      _setIfActive({ streams: [], isLoadingStreams: false });
      return [];
    }
  },

  // V187_STREAMS_RETRY — bump abort token so any in-flight fetchStreams
  // promise's set() calls are no-ops.  Frees the JS thread immediately
  // after the user presses Back on Details.
  cancelInFlightStreams: () => {
    _v187AbortToken++;
  },`;

patchFile(storeFile, 'V187_STREAMS_RETRY', [
  { label: 'B1. add abort token (module scope)',     old: storeOldAbort,         new: storeNewAbort         },
  { label: 'B2. extend interface w/ cancel fn',      old: storeOldInterface,     new: storeNewInterface     },
  { label: 'B3. fetchStreams: abort + retry-once',   old: storeOldFetchStreams,  new: storeNewFetchStreams  },
]);

// ════════════════════════════════════════════════════════════════════════
// C. id.tsx — call cancelInFlightStreams on Back press
// ════════════════════════════════════════════════════════════════════════
//
// We hook into the v186 handleBack (instant unmount) and the hardware-back
// handler, calling useContentStore.getState().cancelInFlightStreams() right
// before _setV186Closing(true).  Frees the JS thread of any pending
// promise resolutions before the next screen takes focus.

const detailsOldHandleBack = `  const handleBack = useCallback(() => {
    // V186_BACK_INSTANT — hide heavy tree IMMEDIATELY, navigate on next frame.
    _setV186Closing(true);
    requestAnimationFrame(() => {
      try {
        if (!goToSeriesRootWithFocus()) router.back();
      } catch (_) {
        try { router.back(); } catch (__) {}
      }
    });
  }, [goToSeriesRootWithFocus, router]);`;
const detailsNewHandleBack = `  const handleBack = useCallback(() => {
    // V187_CANCEL_ON_BACK — kill any in-flight stream fetch so the JS thread
    // is idle when Discover takes focus.  Safe no-op if function not present.
    try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}
    // V186_BACK_INSTANT — hide heavy tree IMMEDIATELY, navigate on next frame.
    _setV186Closing(true);
    requestAnimationFrame(() => {
      try {
        if (!goToSeriesRootWithFocus()) router.back();
      } catch (_) {
        try { router.back(); } catch (__) {}
      }
    });
  }, [goToSeriesRootWithFocus, router]);`;

const detailsOldHwBack = `    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* v134-back-diag + V186_BACK_INSTANT */
      console.log('[BACK v134/v186] main hwBack fired; id=', id, ' type=', type, ' autoPlay=', autoPlayParam);
      // Hide heavy tree on this frame.
      _setV186Closing(true);
      // Navigate on the next frame so React can drop the subtree first.
      requestAnimationFrame(() => {
        try { if (goToSeriesRootWithFocus()) { console.log('[BACK v134] -> series-root-with-focus'); return; } } catch (_) {}
        try { router.back(); console.log('[BACK v134] -> router.back()'); return; } catch (_) {}
        try { router.replace('/(tabs)/discover'); console.log('[BACK v134] -> replace discover'); } catch (_) {}
      });
      return true;
    });`;
const detailsNewHwBack = `    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* v134-back-diag + V186_BACK_INSTANT + V187_CANCEL_ON_BACK */
      console.log('[BACK v134/v186/v187] main hwBack fired; id=', id, ' type=', type, ' autoPlay=', autoPlayParam);
      // V187_CANCEL_ON_BACK — drop any in-flight stream fetch's pending set().
      try { (useContentStore.getState() as any).cancelInFlightStreams?.(); } catch (_) {}
      // V186_BACK_INSTANT — hide heavy tree on this frame, navigate next.
      _setV186Closing(true);
      requestAnimationFrame(() => {
        try { if (goToSeriesRootWithFocus()) { console.log('[BACK v134] -> series-root-with-focus'); return; } } catch (_) {}
        try { router.back(); console.log('[BACK v134] -> router.back()'); return; } catch (_) {}
        try { router.replace('/(tabs)/discover'); console.log('[BACK v134] -> replace discover'); } catch (_) {}
      });
      return true;
    });`;

patchFile(detailsFile, 'V187_CANCEL_ON_BACK', [
  { label: 'C1. handleBack → cancel in-flight streams',  old: detailsOldHandleBack, new: detailsNewHandleBack },
  { label: 'C2. hardware back → cancel in-flight streams', old: detailsOldHwBack,    new: detailsNewHwBack     },
]);

console.log('');
console.log('[v187] All frontend patches done.');
console.log('');
console.log('Next steps:');
console.log('  1. Rebuild & sideload APK:');
console.log('     cd C:\\Users\\Curtm\\PrivastreamCinema\\frontend');
console.log('     npx expo run:android --device');
console.log('');
console.log('  2. ALSO apply v187 backend on Hetzner (widens timeouts + SWR refresh):');
console.log('     ssh choyt@5.161.49.99 "cd ~/PrivastreamCinema && curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/patch_backend_v187_smart_streams.py -o patch_v187.py && python3 patch_v187.py && docker compose restart app"');
console.log('');
console.log('  3. Test on Firestick:');
console.log('     - Addons → focus an addon → press share. Themed gold/dark modal.');
console.log('     - Search "Moonshiners" → streams should populate in 5-7 s.');
console.log('     - Press Back on a Details page — should feel instant.');
