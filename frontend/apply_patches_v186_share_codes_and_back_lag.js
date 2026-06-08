/*
 * apply_patches_v186_share_codes_and_back_lag.js
 *
 * V186 — Frontend bundle (2 files):
 *   A. Addons → Share: include FireStick Downloader code + manifest URL
 *      (addons.tsx)
 *   B. Details → Back: instant unmount (hide heavy tree on press, then
 *      router.back() on the next frame) to kill the perceived lag.
 *      (app/details/[type]/[id].tsx)
 *
 * ─── A. Share with downloader codes ─────────────────────────────────────
 * Today `handleShareAddon` shares only the manifest URL.  User has set
 * Downloader-app shortcodes for the popular addons and wants both the
 * code AND the URL in the shared text:
 *
 *   Cinemeta  → 8762337
 *   Netflix   → 201839
 *   Torrentio → 2519255
 *   TPB       → 970280
 *
 * We rebuild `handleShareAddon` to:
 *   1. Look up a downloader code based on addon name / manifest URL.
 *   2. Build a multi-line share message that contains both the code and
 *      the URL.
 *   3. Show the same in the confirmation Alert so the user can read it
 *      on-screen before sharing.
 *
 * ─── B. Details back-nav instant unmount ────────────────────────────────
 * `animation: 'none'` is already set globally in app/_layout.tsx, so the
 * lag the user perceives is NOT the slide transition — it is React
 * unmounting the heavy Details tree (background image + FlatLists +
 * dozens of FocusableButtons) on a Firestick CPU.
 *
 * Fix: on Back press we IMMEDIATELY hide the content tree (setState to a
 * tiny placeholder) so React drops the heavy subtree on the SAME frame,
 * then schedule router.back() on the very next frame.  Visually the user
 * sees a single black frame (matches the global theme background) and
 * lands on Discover instantly, instead of waiting 400-700 ms for the
 * tree to dismount under the navigator transition.
 *
 * ─── Properties ─────────────────────────────────────────────────────────
 * - Idempotent (markers V186_SHARE_CODES + V186_BACK_INSTANT)
 * - CRLF preserved per file
 * - Backups: addons.tsx.v186.bak, [id].tsx.v186.bak
 *
 * Usage (from frontend project root, on Windows CMD)
 * --------------------------------------------------
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   curl.exe -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v186_share_codes_and_back_lag.js -o apply_patches_v186_share_codes_and_back_lag.js
 *   node apply_patches_v186_share_codes_and_back_lag.js
 *
 * Then: rebuild & install APK.
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
const detailsFile = find([
  ['app', 'details', '[type]', '[id].tsx'],
  ['app', '(tabs)', 'details', '[type]', '[id].tsx'],
  ['app', 'details', '[id].tsx'],
]);

if (!addonsFile) { console.error('[v186] FATAL: addons.tsx not found.'); process.exit(1); }
if (!detailsFile) { console.error('[v186] FATAL: details/[type]/[id].tsx not found.'); process.exit(1); }
console.log('[v186] addons:  ', path.relative(ROOT, addonsFile));
console.log('[v186] details: ', path.relative(ROOT, detailsFile));

// ─── Helper: patch a file with an array of edits ────────────────────────
function patchFile(file, marker, edits) {
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.indexOf('\r\n') !== -1 ? 'crlf' : 'lf';
  let text = eol === 'crlf' ? raw.replace(/\r\n/g, '\n') : raw;

  if (text.indexOf(marker) !== -1) {
    console.log(`[v186] ${path.basename(file)}: already patched (${marker}), skipping.`);
    return false;
  }

  for (const e of edits) {
    if (text.indexOf(e.old) === -1) {
      console.error(`[v186] FATAL anchor missed in ${path.basename(file)}: ${e.label}`);
      console.error(`        looked for:\n${e.old.slice(0, 160)}...`);
      process.exit(2);
    }
    text = text.replace(e.old, e.new, 1);
    console.log(`[v186] ${path.basename(file)}: ${e.label}`);
  }

  const bak = file + '.v186.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, raw, 'utf8');
  const out = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[v186] wrote ${path.relative(ROOT, file)} (${eol.toUpperCase()}, backup=.v186.bak)`);
  return true;
}

// ─── A. addons.tsx — replace handleShareAddon ───────────────────────────
const addonsOldShare = `  const handleShareAddon = async (addon: Addon) => {
    const addonUrl = (addon as any).manifestUrl || addon.url || '';
    const addonName = addon.manifest?.name || 'Addon';
    
    if (!addonUrl) {
      Alert.alert('No URL', 'This addon does not have a shareable URL.');
      return;
    }
    
    Alert.alert(
      \`Share \${addonName}\`,
      \`\${addonUrl}\`,
      [
        { text: 'Copy & Share', onPress: async () => {
          try {
            await Share.share({
              message: \`Check out this Stremio addon: \${addonName}\\n\\n\${addonUrl}\`,
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

const addonsNewShare = `  // V186_SHARE_CODES — share both the FireStick Downloader code (if known)
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

patchFile(addonsFile, 'V186_SHARE_CODES', [
  { label: 'A1. handleShareAddon → include FireStick Downloader code', old: addonsOldShare, new: addonsNewShare },
]);

// ─── B. id.tsx — instant unmount on Back ────────────────────────────────
//
// We:
//  1. Add a `_v186Closing` state flag declared near the other useState calls.
//  2. Wrap the returned JSX in a top-level early-out: if closing → render
//     just a flat <View style={styles.container}/> so React drops the
//     heavy subtree on the same frame.
//  3. Rewrite handleBack to setState(_v186Closing=true) + schedule
//     router.back() on the next animation frame.
//
// Anchor for #1: the existing `const [inLibrary, setInLibrary] = useState(false);`
// (just after the autoPlayTriggeredRef block).
// Anchor for #3: the existing `const handleBack = useCallback(...)`.

const detailsOldStateAnchor = `  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [inLibrary, setInLibrary] = useState(false);`;
const detailsNewStateAnchor = `  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [inLibrary, setInLibrary] = useState(false);
  // V186_BACK_INSTANT — when true, the Details tree renders a flat placeholder
  // so React Native drops the heavy subtree (BackgroundImage + FlatLists +
  // dozens of FocusableButtons) on the SAME frame, then router.back() fires
  // on the next animation frame.  Result: back feels instant on Firestick.
  const [_v186Closing, _setV186Closing] = useState(false);`;

const detailsOldHandleBack = `  const handleBack = useCallback(() => {
    if (!goToSeriesRootWithFocus()) router.back();
  }, [goToSeriesRootWithFocus, router]);`;
const detailsNewHandleBack = `  const handleBack = useCallback(() => {
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

// The hardware-back handler at line ~948 also needs the closing flag so
// physical remote-back gets the same instant-unmount treatment.
const detailsOldHwBack = `    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      /* v134-back-diag */
      console.log('[BACK v134] main hwBack fired; id=', id, ' type=', type, ' autoPlay=', autoPlayParam);
      try { if (goToSeriesRootWithFocus()) { console.log('[BACK v134] -> series-root-with-focus'); return true; } } catch (_) {}
      try { router.back(); console.log('[BACK v134] -> router.back()'); return true; } catch (_) {}
      try { router.replace('/(tabs)/discover'); console.log('[BACK v134] -> replace discover'); } catch (_) {}
      return true;
    });`;
const detailsNewHwBack = `    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
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

// Find a stable anchor right before the outermost <View> of the screen
// return JSX.  We tag it with a placeholder branch.
// The component's main return starts at:  `return (\n    <View style={styles.container}>`
// We inject:  if (_v186Closing) return (<View style={styles.container} />);
// just inside the function body, right before that return.
//
// The previous block (line ~2099-ish) is:
//    </ScrollView>
//      </View>
//    </View>
//  );
// }
//
// To keep this surgically safe we look for the unique render preamble:
//   `  return (\n    <View style={styles.container}>`
const detailsOldReturn = `  return (
    <View style={styles.container}>`;
const detailsNewReturn = `  // V186_BACK_INSTANT — render a flat placeholder once the user has pressed
  // back.  The heavy subtree dismounts on this frame; navigation runs next.
  if (_v186Closing) {
    return <View style={styles.container} />;
  }
  return (
    <View style={styles.container}>`;

patchFile(detailsFile, 'V186_BACK_INSTANT', [
  { label: 'B1. add _v186Closing state',         old: detailsOldStateAnchor, new: detailsNewStateAnchor },
  { label: 'B2. handleBack → instant unmount',   old: detailsOldHandleBack,  new: detailsNewHandleBack  },
  { label: 'B3. hardwareBackPress → instant',    old: detailsOldHwBack,      new: detailsNewHwBack      },
  { label: 'B4. early-out render placeholder',   old: detailsOldReturn,      new: detailsNewReturn      },
]);

console.log('');
console.log('[v186] All file patches done.');
console.log('');
console.log('Next steps:');
console.log('  1. Rebuild & sideload APK:');
console.log('     cd C:\\Users\\Curtm\\PrivastreamCinema\\frontend');
console.log('     npx expo run:android --device');
console.log('  2. Re-test:');
console.log('     - Addons → ⋯ → Share on Cinemeta / Netflix / Torrentio / TPB');
console.log('       (should show both the downloader code AND the URL).');
console.log('     - Open any Details page → press Back (TV remote or back arrow).');
console.log('       (should feel instant — no 400-700 ms freeze).');
