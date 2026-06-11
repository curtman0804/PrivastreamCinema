/*
 * apply_patches_v199_true_discover_wipe.js
 *
 * WHY v198 WASN'T ENOUGH — there are THREE frontend discover cache layers:
 *   1. zustand `discoverData` (memory)            -> v198 cleared this. OK.
 *   2. AsyncStorage written by setCache('discover_data')
 *      The cache util PREFIXES its keys, so v198's removeItem('discover_data')
 *      removed nothing. STALE.
 *   3. discover.tsx LOCAL state `cachedDiscover` (the v144 cold-start snapshot)
 *      Lives in React component memory. flatRowsV54 falls back to it:
 *      `discoverData?.services || cachedDiscover?.services` — so even after a
 *      store wipe, stale posters keep rendering. NEVER CLEARED by v198.
 *
 * v199 fixes all three:
 *   A. nukeDiscoverCache now enumerates ALL AsyncStorage keys and multiRemoves
 *      every key containing "discover" (any prefix, any version). It also sets
 *      `discoverNukeStamp: Date.now()` in the store.
 *   B. discover.tsx subscribes to discoverNukeStamp and drops its local
 *      `cachedDiscover` snapshot instantly when it changes.
 *
 * Self-sufficient: if v198 was never applied, v199 injects the full action and
 * wires addons.tsx itself. Idempotent (V199_TRUE_WIPE marker). CRLF-safe.
 *
 * Usage (Windows CMD):
 *   cd C:\Users\Curtm\PrivastreamCinema\frontend
 *   node apply_patches_v199_true_discover_wipe.js
 *   npx expo run:android --device
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
function find(c){for(const p of c){const f=path.join(ROOT,...p);if(fs.existsSync(f))return f}return null}
const addonsFile   = find([['app','(tabs)','addons.tsx'],['app','addons.tsx']]);
const storeFile    = find([['src','store','contentStore.ts'],['src','stores','contentStore.ts']]);
const discoverFile = find([['app','(tabs)','discover.tsx'],['app','discover.tsx']]);
if(!addonsFile||!storeFile||!discoverFile){
  console.error('[v199] FATAL: files not found', {addonsFile, storeFile, discoverFile});
  process.exit(1);
}

function read(file){
  const raw = fs.readFileSync(file,'utf8');
  const eol = raw.indexOf('\r\n')!==-1?'crlf':'lf';
  const text = eol==='crlf' ? raw.replace(/\r\n/g,'\n') : raw;
  return {raw, eol, text};
}
function write(file, st, tag){
  const bak = file + '.v199.bak';
  if (!fs.existsSync(bak)) fs.writeFileSync(bak, st.raw, 'utf8');
  const out = st.eol==='crlf' ? st.text.replace(/\n/g,'\r\n') : st.text;
  fs.writeFileSync(file, out, 'utf8');
  console.log(`[v199] ${path.basename(file)}: ${tag}`);
}

let applied = 0, skipped = 0, failed = 0;

// ────────────────────────────────────────────────────────────────
// PATCH A — contentStore.ts: true-wipe nukeDiscoverCache + nuke stamp
// ────────────────────────────────────────────────────────────────
const V199_ACTION = `  // V198_NUKE_DISCOVER / V199_TRUE_WIPE — clear EVERY discover cache layer
  nukeDiscoverCache: async () => {
    try { set({ discoverData: null, isLoadingDiscover: false, discoverNukeStamp: Date.now() } as any); } catch (_) {}
    try {
      const AS = require('@react-native-async-storage/async-storage').default;
      const keys = await AS.getAllKeys();
      const targets = (keys || []).filter((k) => typeof k === 'string' && k.toLowerCase().indexOf('discover') !== -1);
      if (targets.length > 0) { await AS.multiRemove(targets); }
    } catch (_) {}
  },
`;

{
  const st = read(storeFile);
  if (st.text.indexOf('V199_TRUE_WIPE') !== -1) {
    console.log('[v199] contentStore.ts: already applied'); skipped++;
  } else if (st.text.indexOf('V198_NUKE_DISCOVER') !== -1) {
    // Replace the entire v198-injected action body with the v199 version.
    const v198Block = /  \/\/ V198_NUKE_DISCOVER[^\n]*\n  nukeDiscoverCache: async \(\) => \{[\s\S]*?\n  \},\n/;
    if (!v198Block.test(st.text)) {
      console.error('[v199] FATAL: V198 marker found but action block did not match'); failed++;
    } else {
      st.text = st.text.replace(v198Block, V199_ACTION);
      write(storeFile, st, 'upgraded nukeDiscoverCache to TRUE wipe (all AsyncStorage discover keys + nuke stamp)');
      applied++;
    }
  } else {
    // v198 never applied — inject fresh. Try the v190 anchor first, then fall
    // back to the universal `fetchDiscover: async` implementation line.
    const v190Anchor = "  // V190_STORE_DEF — drop any in-flight fetch's state-writes\n  cancelInFlightStreams: () => {";
    const fdAnchor = "  fetchDiscover: async (forceRefresh = false) => {";
    let injected = false;
    if (st.text.indexOf(v190Anchor) !== -1) {
      st.text = st.text.replace(v190Anchor, V199_ACTION + '\n' + v190Anchor);
      injected = true;
    } else if (st.text.indexOf(fdAnchor) !== -1) {
      st.text = st.text.replace(fdAnchor, V199_ACTION + '\n' + fdAnchor);
      injected = true;
    }
    if (!injected) {
      console.error('[v199] FATAL: neither V190 anchor nor fetchDiscover anchor found in contentStore'); failed++;
    } else {
      const iface190 = "  // V190_STORE_DEF\n  cancelInFlightStreams: () => void;";
      const ifaceFd = "  fetchDiscover: (forceRefresh?: boolean) => Promise<void>;";
      if (st.text.indexOf(iface190) !== -1) {
        st.text = st.text.replace(iface190, `  // V199_TRUE_WIPE\n  nukeDiscoverCache: () => Promise<void>;\n${iface190}`);
      } else if (st.text.indexOf(ifaceFd) !== -1) {
        st.text = st.text.replace(ifaceFd, `${ifaceFd}\n  // V199_TRUE_WIPE\n  nukeDiscoverCache: () => Promise<void>;`);
      }
      write(storeFile, st, 'injected TRUE-wipe nukeDiscoverCache action');
      applied++;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH B — discover.tsx: drop local cachedDiscover snapshot on nuke
// ────────────────────────────────────────────────────────────────
{
  const st = read(discoverFile);
  if (st.text.indexOf('V199_TRUE_WIPE') !== -1) {
    console.log('[v199] discover.tsx: already applied'); skipped++;
  } else {
    const anchor = '  const [cachedDiscover, setCachedDiscover] = useState<any>(null);';
    if (st.text.indexOf(anchor) === -1) {
      // v144 snapshot layer absent — nothing local to clear. Not fatal.
      console.log('[v199] discover.tsx: v144 cachedDiscover layer not found — skipping local-snapshot clear (layer does not exist)');
      skipped++;
    } else {
      const inject = `${anchor}
  // V199_TRUE_WIPE — when the store nukes discover caches, drop the local v144 snapshot too
  const discoverNukeStamp = useContentStore((s: any) => (s as any).discoverNukeStamp);
  useEffect(() => {
    if (discoverNukeStamp) {
      try { setCachedDiscover(null); } catch (_) {}
    }
  }, [discoverNukeStamp]);`;
      st.text = st.text.replace(anchor, inject);
      write(discoverFile, st, 'local cachedDiscover snapshot now wiped on nuke stamp');
      applied++;
    }
  }
}

// ────────────────────────────────────────────────────────────────
// PATCH C — addons.tsx: ensure nukeDiscoverCache runs on install/uninstall
// (already wired if v198 was applied)
// ────────────────────────────────────────────────────────────────
{
  const st = read(addonsFile);
  if (st.text.indexOf('V198_NUKE_DISCOVER') !== -1 || st.text.indexOf('V199_TRUE_WIPE') !== -1) {
    console.log('[v199] addons.tsx: nuke call already wired (v198)'); skipped++;
  } else {
    const oldPattern = /await fetchAddons\(true\);\s*\n\s*fetchDiscover\(true\);/g;
    const matches = st.text.match(oldPattern);
    if (!matches || matches.length === 0) {
      console.error('[v199] FATAL: no fetchAddons+fetchDiscover pair found in addons.tsx'); failed++;
    } else {
      st.text = st.text.replace(oldPattern, `// V199_TRUE_WIPE — wipe ALL frontend discover caches before re-fetching
      try { await (useContentStore.getState() as any).nukeDiscoverCache?.(); } catch (_) {}
      await fetchAddons(true);
      fetchDiscover(true);`);
      write(addonsFile, st, `wired nuke into ${matches.length} install/uninstall path(s)`);
      applied++;
    }
  }
}

console.log('');
console.log(`[v199] Summary: ${applied} applied, ${skipped} skipped/already, ${failed} failed.`);
if (failed > 0) process.exit(2);
console.log('');
console.log('[v199] Done. Next:');
console.log('  npx expo run:android --device');
console.log('');
console.log('Test: install addon -> back to Discover -> new sections appear within ~3 s.');
console.log('      uninstall addon -> sections vanish. NO force-stop / clear-data needed.');
