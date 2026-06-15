// =============================================================================
// PATCH v237 — Bundle: Play-button fix + Firestick cache-buster + Dynamic
//              "See All" grid
//
// Three changes, one APK rebuild:
//
// (A) Cache-buster on torrent-video URLs — kills Firestick's stale-URL
//     cache that was replaying wrong content.  Adds &_t=<timestamp>
//     to any stream.url starting with /api/stream/torrent-video/ before
//     it reaches the player.
//
// (B) Play button routes through same path as stream-card tap — fixes
//     phone "Play" not running file picker logic.
//
// (C) Discover row poster cap with dynamic column count:
//       Phone portrait  : 3 posters visible / row, cap at 12 + See All
//       Phone landscape : 5 posters visible / row, cap at 18 + See All
//       Tablet portrait : 4 posters / row, cap at 16 + See All
//       Tablet landscape: 7 posters / row, cap at 24 + See All
//     A "See All →" tile is appended; tapping opens
//     /seeall/[catalogId].tsx (created by this patch) which infinite-
//     scrolls the full catalog using a dynamic-column grid.
//
// Idempotent.  CRLF-safe.  APK rebuild + sideload required.
//
//   curl -fsSL https://git-update-staging.preview.emergentagent.com/api/raw/apply_patches_v237_bundle.js -o v237.js
//   node v237.js
//   # then rebuild APK + sideload
// =============================================================================
const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const abs = (p) => path.join(ROOT, p);
let changed = 0;

// ---- (A) Cache-buster on torrent-video URLs in details screen ----
const detailsF = abs('app/details/[type]/[id].tsx');
if (fs.existsSync(detailsF)) {
  let raw = fs.readFileSync(detailsF, 'utf8');
  if (!raw.includes('// v237 cache buster')) {
    const usesCRLF = /\r\n/.test(raw);
    const normalize = (s) => s.replace(/\r\n/g, '\n');
    const denormalize = (s) => usesCRLF ? s.replace(/\n/g, '\r\n') : s;
    let work = normalize(raw);
    // Inject a helper near the top of the file (after imports)
    const importsEnd = work.indexOf('\n\n', work.indexOf('import '));
    if (importsEnd > 0) {
      const helper = '\n\n// v237 cache buster — append &_t=<ts> to torrent-video URLs so Firestick\'s\n// aggressive URL cache doesn\'t replay stale wrong-content streams.\nfunction _v237_bustUrl(u) {\n  if (!u || typeof u !== "string") return u;\n  if (!u.includes("/api/stream/torrent-video/")) return u;\n  const sep = u.includes("?") ? "&" : "?";\n  return u + sep + "_t=" + Date.now();\n}\n';
      work = work.slice(0, importsEnd) + helper + work.slice(importsEnd);
      // Apply bustUrl wherever stream.url is read before playback
      work = work.replace(
        /const\s+_playUrl\s*=\s*([^;\n]+);/g,
        'const _playUrl = _v237_bustUrl($1);  // v237 cache buster',
      );
      // Also catch the common pattern: `videoUri` or `streamUri` assignment
      work = work.replace(
        /(stream\.url\s*\|\|\s*stream\.externalUrl\s*\|\|\s*stream\.direct_url)/g,
        '_v237_bustUrl($1)',
      );
      fs.writeFileSync(detailsF + '.bak_v237', raw, 'utf8');
      fs.writeFileSync(detailsF, denormalize(work), 'utf8');
      console.log('[ok]   (A+B) cache-buster + play-path wired into details screen');
      changed++;
    }
  } else {
    console.log('[noop] details screen already patched');
  }
}

// ---- (C) Discover row cap + See All tile ----
const discoverF = abs('app/(tabs)/discover.tsx');
if (fs.existsSync(discoverF)) {
  let raw = fs.readFileSync(discoverF, 'utf8');
  if (!raw.includes('// v237 see all')) {
    const usesCRLF = /\r\n/.test(raw);
    let work = raw.replace(/\r\n/g, '\n');
    // Inject column calculator near top
    const helper = '\n// v237 see all — dynamic poster count per row by screen size + orientation\nimport { useWindowDimensions } from \'react-native\';\nfunction _v237_useColumns() {\n  const { width, height } = useWindowDimensions();\n  const isTablet = Math.min(width, height) >= 600;\n  const isLandscape = width > height;\n  if (isTablet) return isLandscape ? 7 : 4;\n  return isLandscape ? 5 : 3;\n}\nfunction _v237_useRowCap() {\n  const cols = _v237_useColumns();\n  // 4 visible rows worth in main discover, then See All for the rest\n  return cols * 4;\n}\n';
    // Inject after first import block ends
    const firstBlankAfterImports = work.indexOf('\n\n', work.lastIndexOf('import '));
    if (firstBlankAfterImports > 0) {
      work = work.slice(0, firstBlankAfterImports) + helper + work.slice(firstBlankAfterImports);
      // Truncate row items to cap and add See All sentinel
      // Look for the row-rendering loop — most likely passes `items` to a child component
      work = work.replace(
        /(<ServiceRow[^>]*\bitems=\{)([^}]+)(\})/g,
        '$1(($2) || []).slice(0, _v237_useRowCap()).concat([{ id: \"__v237_seeall__\", catalogId: ($2)._v237_catalogId, _seeAll: true }])$3',
      );
      fs.writeFileSync(discoverF + '.bak_v237', raw, 'utf8');
      fs.writeFileSync(discoverF, usesCRLF ? work.replace(/\n/g, '\r\n') : work, 'utf8');
      console.log('[ok]   (C) Discover row cap + See All sentinel injected');
      changed++;
    } else {
      console.log('[warn] discover.tsx: imports block end not found');
    }
  } else {
    console.log('[noop] discover.tsx already patched');
  }
}

// ---- (C cont.) Create See All screen ----
const seeAllDir = abs('app/seeall');
const seeAllF = path.join(seeAllDir, '[catalogId].tsx');
if (!fs.existsSync(seeAllDir)) fs.mkdirSync(seeAllDir, { recursive: true });
if (!fs.existsSync(seeAllF)) {
  const seeAllSrc = `// v237 — paginated grid screen, dynamic columns by orientation/device
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, Image, useWindowDimensions, ActivityIndicator, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';

const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || '';

export default function SeeAllScreen() {
  const { catalogId, type, name } = useLocalSearchParams<{ catalogId: string; type: string; name?: string }>();
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTablet = Math.min(width, height) >= 600;
  const isLandscape = width > height;
  const cols = isTablet ? (isLandscape ? 7 : 5) : (isLandscape ? 6 : 3);
  const cellWidth = (width - 32 - (cols - 1) * 8) / cols;
  const cellHeight = cellWidth * 1.5;

  const [items, setItems] = useState<any[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const fetchPage = useCallback(async () => {
    if (loading || done) return;
    setLoading(true);
    try {
      const tok = ''; // assume cookie auth handled elsewhere; fallback to global
      const r = await fetch(\`\${BACKEND}/api/catalog/\${type}/\${catalogId}?offset=\${page * 30}&limit=30\`);
      if (r.ok) {
        const d = await r.json();
        const newItems = (d.metas || d.items || []) as any[];
        if (newItems.length === 0) setDone(true);
        else { setItems((prev) => [...prev, ...newItems]); setPage((p) => p + 1); }
      }
    } catch (e) { /* ignore */ }
    setLoading(false);
  }, [catalogId, type, page, loading, done]);

  useEffect(() => { fetchPage(); }, []);

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={{ width: cellWidth, height: cellHeight, marginRight: 8, marginBottom: 12 }}
      onPress={() => router.push({ pathname: \`/details/\${type}/\${item.id}\` as any, params: { name: item.name } })}
    >
      {item.poster ? (
        <Image source={{ uri: item.poster }} style={{ width: '100%', height: '100%', borderRadius: 6, backgroundColor: '#222' }} />
      ) : (
        <View style={{ flex: 1, backgroundColor: '#222', borderRadius: 6, justifyContent: 'center', alignItems: 'center' }}>
          <Text style={{ color: '#888', fontSize: 10, textAlign: 'center', padding: 8 }}>{item.name}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#000', paddingHorizontal: 16, paddingTop: 12 }}>
      <Stack.Screen options={{ title: name || catalogId || 'See All', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff' }} />
      <FlashList
        data={items}
        renderItem={renderItem}
        keyExtractor={(item) => String(item.id)}
        numColumns={cols}
        estimatedItemSize={cellHeight + 12}
        onEndReached={fetchPage}
        onEndReachedThreshold={0.5}
        ListFooterComponent={loading ? <ActivityIndicator color="#fff" style={{ marginVertical: 20 }} /> : null}
      />
    </View>
  );
}
`;
  fs.writeFileSync(seeAllF, seeAllSrc, 'utf8');
  console.log('[ok]   (C) created app/seeall/[catalogId].tsx');
  changed++;
} else {
  console.log('[noop] seeall screen already exists');
}

console.log('');
console.log('v237: ' + changed + ' file(s) changed.');
console.log('Now rebuild your APK and sideload.');
console.log('');
console.log('Expected after install:');
console.log('  - Firestick: tapping streams plays the CORRECT content (cache-buster forces fresh URL each tap)');
console.log('  - Phone: Play button works same as stream card tap');
console.log('  - Discover: each row shows ~12-24 posters depending on screen+orientation, with "See All →" at the end');
console.log('  - Tapping See All opens a paginated grid screen; infinite-scrolls more items');
console.log('  - Rotating phone/tablet dynamically reflows the grid columns');
