// v212 loading isolation
// v241 — useDeferredValue: deprioritise flatRows mapping to keep JS thread free
import React, { useEffect, useCallback, useState, useMemo, useRef, startTransition, useDeferredValue } from 'react';
import {
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
  Animated,
  Easing,
} from 'react-native';
// PATCH_V145_LAYOUTANIM_IMPORT — enable LayoutAnimation on Android once at module load
if (Platform.OS === 'android' && UIManager && (UIManager as any).setLayoutAnimationEnabledExperimental) {
  try { (UIManager as any).setLayoutAnimationEnabledExperimental(true); } catch (_) {}
}
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore, useDiscoverData } from '../../src/store/contentStore'; // PATCH_V245_OWNERSHIP
import { getMetaCache, setMetaCache } from '../../src/store/contentStore';
import { FlashList } from '@shopify/flash-list'; // PATCH_V54_VIRTUALIZE
import { ServiceRow } from '../../src/components/ServiceRow';
import { ContentItem, api, WatchProgress } from '../../src/api/client';
/* V176_LONGPRESS_MENU — extend the ContentCard import with the
   watched/progress helpers + unified menu opener. */
import {
  getCardWidth,
  v160GetPoster as _v160GetPoster,
  v160SubscribePoster as _v160SubscribePoster /* V166_POSTER_SUB */,
  v167PrewarmReleaseStatus as _v167PrewarmReleaseStatus /* V167_RELEASE_PREWARM */,
  v172IsWatched as _v172IsWatched,
  v172SubscribeWatched as _v172SubscribeWatched,
  v176RegisterProgress as _v176RegisterProgress,
  v176HasProgress as _v176HasProgress,
  v176SubscribeProgress as _v176SubscribeProgress,
  v176ShowLongPressMenu as _v176ShowLongPressMenu,
  /* V176E_TV_LONGPRESS — register this CW card's menu handler with v173. */
  v173RegisterLongPress as _v173RegLP,
  /* V176K_POPOVER */ V176kPopover, v176kMeasureAnchor
} from '../../src/components/ContentCard';
import { colors } from '../../src/styles/colors';
import { Image as RNImage } from 'react-native';
// PATCH_V144_CACHE_IMPORT — disk-backed snapshot for instant cold-start paint
import AsyncStorage from '@react-native-async-storage/async-storage';

const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');

// ============================================================
// V274_LOGO_SKELETON
// ============================================================
// Cold-boot skeleton: instead of a single ActivityIndicator (or the
// reverted "Awesomeness Awaits" splash), we paint two rows of
// logo-only placeholder cards.  Same visual language as the no-poster
// fallback elsewhere, so the screen immediately has STRUCTURE even
// before live data arrives.  No copy, no spinners — just the layout
// the user will see once posters load.
// ============================================================
function LogoSkeleton() {
  const cardW = 120;
  const cardH = 180;
  const gap = 12;
  const cards = Array.from({ length: 6 });
  const Row = ({ title }: { title: string }) => (
    <View style={{ marginBottom: 28 }}>
      <View style={{ paddingHorizontal: 16, marginBottom: 10 }}>
        <View
          style={{
            width: 160,
            height: 18,
            backgroundColor: 'rgba(255,255,255,0.08)',
            borderRadius: 4,
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', paddingHorizontal: 16 }}>
        {cards.map((_, i) => (
          <View
            key={i}
            style={{
              width: cardW,
              height: cardH,
              marginRight: i === cards.length - 1 ? 0 : gap,
              backgroundColor: '#1a1a1a',
              borderRadius: 6,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <RNImage
              source={require('../../assets/images/logo_header.png')}
              style={{ width: '60%', height: '30%', opacity: 0.35 }}
              resizeMode="contain"
            />
          </View>
        ))}
      </View>
    </View>
  );
  return (
    <View style={{ flex: 1, paddingTop: 24 }}>
      <Row title="Continue Watching" />
      <Row title="Trending" />
      <Row title="Popular Movies" />
    </View>
  );
}

// ============================================================
// V271_COLD_BOOT_ACCELERATOR
// ============================================================
// Read the cached Discover snapshot from AsyncStorage as soon as this
// module is imported (i.e., at app boot, BEFORE the Discover screen
// mounts).  The previous code did the read in a useEffect, which fires
// AFTER the first render and delays the cached-paint by ~50–300 ms on
// Firestick.  Now the read is in-flight while the JS bundle is still
// initialising — by the time Discover's first useEffect runs, the
// result is usually already resolved.
//
// We also kick off `expo-image.prefetch(...)` on the top ~24 posters
// from the cached snapshot at module load, so by the time ContentCards
// mount their <Image>, the bytes are already in expo-image's
// memory-disk cache → near-instant paint.
// ============================================================
type _V271Snapshot = { discover: any | null; cw: any[] | null };
const _v271BootSnapshotPromise: Promise<_V271Snapshot> = (async () => {
  try {
    const [d, c] = await Promise.all([
      AsyncStorage.getItem('@ps_discover_v1'),
      AsyncStorage.getItem('@ps_cw_v1'),
    ]);
    const snap: _V271Snapshot = {
      discover: d ? (() => { try { return JSON.parse(d); } catch (_) { return null; } })() : null,
      cw: c ? (() => { try { return JSON.parse(c); } catch (_) { return null; } })() : null,
    };
    // Kick off poster prefetch on top ~24 posters from the cached
    // snapshot.  Fire-and-forget — expo-image dedupes URLs internally.
    try {
      const urls: string[] = [];
      const services = (snap.discover as any)?.services || {};
      for (const svc of Object.values(services)) {
        for (const bucket of ['movies', 'series', 'channels']) {
          const list = (svc as any)?.[bucket] || [];
          for (const it of list.slice(0, 6)) {
            if (it && it.poster) urls.push(String(it.poster));
          }
        }
        if (urls.length >= 24) break;
      }
      if (urls.length > 0) {
        const { Image: _ExpoImage } = require('expo-image');
        _ExpoImage.prefetch(urls, 'memory-disk');
        console.log('[V271_BOOT] prefetched', urls.length, 'cached posters at module load');
      }
    } catch (_) {}
    return snap;
  } catch (_) {
    return { discover: null, cw: null };
  }
})();

// Synchronous accessor (returns null until the promise resolves).
let _v271ResolvedSnapshot: _V271Snapshot | null = null;
_v271BootSnapshotPromise.then((s) => { _v271ResolvedSnapshot = s; }).catch(() => {});

// PATCH_V15B_LAZYMOUNT_COMPONENT
// Defers child mounting by `delay` ms then waits for the next idle window
// (InteractionManager) before rendering. Used to stagger discover service
// rows so the JS thread is not pegged with N FlatLists on cold start.
function LazyMount({ delay, children, placeholder }: { delay: number; children: React.ReactNode; placeholder?: React.ReactNode }) {
  const [shouldMount, setShouldMount] = useState(delay <= 0);
  useEffect(() => {
    if (delay <= 0) return;
    let cancelled = false;
    const t = setTimeout(() => {
      InteractionManager.runAfterInteractions(() => {
        if (!cancelled) setShouldMount(true);
      });
    }, delay);
    return () => { cancelled = true; clearTimeout(t); };
  }, [delay]);
  if (!shouldMount) return (placeholder ?? null) as any;
  return <>{children}</>;
}

// V181_DISCOVER_THROTTLE — module-scope timestamp survives unmount/remount.
// Initial value = 0 means "never fetched", so the FIRST mount always fetches.
let _v181_lastDiscoverFetch: number = 0;


export default function DiscoverScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  
  // CRITICAL: Use zustand SELECTORS — only re-render when these specific fields change.
  // Without selectors, the Discover page re-renders when ANY store field changes
  // (e.g., when Details page loads streams), causing hundreds of poster images
  // to re-render and blocking the JS thread for 3+ seconds.
  // PATCH_V245_OWNERSHIP — useDiscoverData() returns null when the data's
  // owner UID doesn't match the currently-logged-in JWT user.  This prevents
  // stale posters from a previous user (test) bleeding into the new user
  // (choyt) session during the first render after a warm logout/login.
  const discoverData = useDiscoverData();
  const isLoadingDiscover = useContentStore(s => s.isLoadingDiscover);
  const fetchDiscover = useContentStore(s => s.fetchDiscover);
  const fetchAddons = useContentStore(s => s.fetchAddons);
  const addons = useContentStore(s => s.addons);
  const [refreshing, setRefreshing] = useState(false);
  const [continueWatching, setContinueWatching] = useState<WatchProgress[]>([]);
  // V274_CW_INSTANT_REMOVE — hard hide gate for the CW row.  Set true
  // when the user clears the LAST CW item; bypasses useDeferredValue
  // lag on flatRows so the row disappears in the very same frame as
  // the button press.  Cleared automatically when new CW data arrives.
  const [cwForceHidden, setCwForceHidden] = useState(false);
  const [isLoadingProgress, setIsLoadingProgress] = useState(false);
  // PATCH_V144_CACHE_STATE — snapshots loaded from AsyncStorage on cold mount
  const [cachedDiscover, setCachedDiscover] = useState<any>(null);
  // V199_TRUE_WIPE — when the store nukes discover caches, drop the local v144 snapshot too
  const discoverNukeStamp = useContentStore((s: any) => (s as any).discoverNukeStamp);
  useEffect(() => {
    if (discoverNukeStamp) {
      try { setCachedDiscover(null); } catch (_) {}
    }
  }, [discoverNukeStamp]);
  const [cachedCW, setCachedCW] = useState<WatchProgress[]>([]);
  const scrollViewRef = useRef<ScrollView>(null);
  const sectionPositions = useRef<Record<string, number>>({});
  const lastFocusedSection = useRef<string>('');
  const lastCWFetchTime = useRef<number>(0);

  // Use same card width calculation as ContentCard for consistency
  const POSTER_WIDTH = getCardWidth(width, isTV, 'medium');
  const POSTER_HEIGHT = POSTER_WIDTH * 1.5;

  // Fetch continue watching data
  const fetchContinueWatching = useCallback(async () => {
    try {
      setIsLoadingProgress(true);
      const response = await api.watchProgress.getAll();
      const _v204Next = response.continueWatching || [];
      // V274_CW_INSTANT_REMOVE — fresh CW data arrived; if it has items,
      // the force-hidden gate is no longer needed (user added something
      // new, or backend returned content they haven't seen locally).
      if (_v204Next.length > 0 && cwForceHidden) {
        setCwForceHidden(false);
      }
      // v212 loading isolation — defer the CW re-render so D-pad focus events
      // arriving in the same tick are NOT blocked by reconciliation.
      startTransition(() => {
        // V204_SKIP_IDENTICAL — unchanged CW => keep previous array reference
        setContinueWatching(prev => {
          try { if (JSON.stringify(prev) === JSON.stringify(_v204Next)) return prev; } catch (_) {}
          return _v204Next;
        });
      });
      lastCWFetchTime.current = Date.now();
    } catch (err) {
      console.log('[Discover] Error fetching continue watching:', err);
    } finally {
      // v212 loading isolation — same: loader flag is non-urgent
      startTransition(() => { setIsLoadingProgress(false); });
    }
  }, []);

  useEffect(() => {
    // v211 cold-boot — paint Discover from AsyncStorage cache (hydrated in
    // the next useEffect) FIRST.  The three network fetches go through
    // InteractionManager so they don't compete with row mount work for the
    // JS thread on the first ~500 ms after mount.
    const _v211H = InteractionManager.runAfterInteractions(() => {
      try { fetchDiscover(); } catch (_) {}
      try { fetchContinueWatching(); } catch (_) {}
      try { fetchAddons(); } catch (_) {}
    });
    return () => { try { (_v211H as any).cancel && (_v211H as any).cancel(); } catch (_) {} };
  }, []);

  // v213 bottom + prefetch — warm expo-image's cache with the first ~24
  // discover posters so they paint instantly as they enter the viewport.
  // Deferred via InteractionManager so the prefetch network burst can't
  // compete with the first paint frame.
  // V271_COLD_BOOT_ACCELERATOR — also fires on cachedDiscover so we
  // warm cache from the disk snapshot before live data arrives.
  // V276_HOLD_SPINNER_TILL_POSTERS — also flip postersReady AFTER the
  // top-row prefetch resolves so the spinner stays up until the visible
  // posters are actually in expo-image's disk/memory cache.  Hard cap
  // at 4s so we never get stuck if a poster URL is dead.
  const _v213PrefetchDone = useRef(false);
  const [postersReady, setPostersReady] = useState(false);
  useEffect(() => {
    if (_v213PrefetchDone.current) return;
    const source: any = discoverData || cachedDiscover;
    if (!source) return;
    const urls: string[] = [];
    try {
      const services = (source as any).services || {};
      for (const svc of Object.values(services)) {
        for (const bucket of ['movies', 'series', 'channels']) {
          const list = (svc as any)?.[bucket] || [];
          for (const it of list.slice(0, 6)) {
            if (it && it.poster) urls.push(String(it.poster));
          }
        }
        if (urls.length >= 24) break;
      }
    } catch (_) {}
    if (urls.length === 0) {
      // No posters to prefetch — flip ready immediately.
      setPostersReady(true);
      return;
    }
    _v213PrefetchDone.current = true;

    // V276 — hard 4s cap so the spinner can never get stuck if a CDN
    // is slow or a URL is dead.
    const _capTimer = setTimeout(() => setPostersReady(true), 4000);

    const h = InteractionManager.runAfterInteractions(() => {
      try {
        const { Image: _ExpoImage } = require('expo-image');
        // expo-image.prefetch returns a Promise that resolves when the
        // batch is in cache (memory + disk).  Await it then unblock the UI.
        const _p = _ExpoImage.prefetch(urls, 'memory-disk');
        if (_p && typeof _p.then === 'function') {
          _p.then(() => {
            clearTimeout(_capTimer);
            setPostersReady(true);
          }).catch(() => {
            clearTimeout(_capTimer);
            setPostersReady(true);
          });
        } else {
          // Fallback: legacy expo-image returned void → assume ready next tick.
          setTimeout(() => {
            clearTimeout(_capTimer);
            setPostersReady(true);
          }, 800);
        }
      } catch (_) {
        clearTimeout(_capTimer);
        setPostersReady(true);
      }
    });
    return () => {
      try { (h as any).cancel && (h as any).cancel(); } catch (_) {}
      clearTimeout(_capTimer);
    };
  }, [discoverData, cachedDiscover]);

  // PATCH_V144_CACHE_HYDRATE — load disk snapshot on cold start for instant paint.
  // V271_COLD_BOOT_ACCELERATOR — the AsyncStorage read was kicked off at module
  // load (above), so the promise is usually already resolved by the time this
  // effect runs.  We also drop the `startTransition` wrapper so the cached
  // paint is treated as URGENT (it's the only thing on screen, no other state
  // updates to compete with).
  useEffect(() => {
    // Fast path: synchronous resolved snapshot.
    if (_v271ResolvedSnapshot) {
      if (_v271ResolvedSnapshot.discover) setCachedDiscover(_v271ResolvedSnapshot.discover);
      if (_v271ResolvedSnapshot.cw) setCachedCW(_v271ResolvedSnapshot.cw);
      return;
    }
    // Slow path: await the in-flight boot promise (still faster than firing
    // a fresh getItem here).
    (async () => {
      try {
        const snap = await _v271BootSnapshotPromise;
        if (snap.discover) setCachedDiscover(snap.discover);
        if (snap.cw) setCachedCW(snap.cw);
      } catch (_) {}
    })();
  }, []);

  // PATCH_V144_CACHE_PERSIST — snapshot store data to disk on every update
  useEffect(() => {
    if (!discoverData?.services) return;
    // V204_DEFER_PERSIST — big JSON.stringify + disk write off the critical frame
    const h = InteractionManager.runAfterInteractions(() => {
      try {
        AsyncStorage.setItem('@ps_discover_v1', JSON.stringify(discoverData)).catch(() => {});
      } catch (_) {}
    });
    return () => { try { h.cancel(); } catch (_) {} };
  }, [discoverData]);

  useEffect(() => {
    try {
      AsyncStorage.setItem('@ps_cw_v1', JSON.stringify(continueWatching || [])).catch(() => {});
    } catch (_) {}
  }, [continueWatching]);

  /* V176_LONGPRESS_MENU — keep the in-memory progress registry in sync
     with the live CW list (and the disk-cached fallback) so the unified
     long-press menu shows "Clear Progress" for items that are in CW. */
  useEffect(() => {
    const ids: string[] = [];
    const live = (continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW;
    for (const it of (live || [])) {
      const cid = (it as any).content_id || (it as any).imdb_id || (it as any).id;
      if (cid) ids.push(String(cid));
    }
    _v176RegisterProgress(ids);
  }, [continueWatching, cachedCW]);

  // V167_RELEASE_PREWARM — fire ONE bulk /api/movie/release_status POST
  // as soon as we know which movies are on screen.  By the time row
  // ContentCards mount and subscribe, the cache is already hot and the
  // IN CINEMA badge paints on the same frame as the poster.  Skips ids
  // that are already cached or in-flight (so back-nav is a no-op).
  // V305_PREWARM_DEFER_BUILD_TAG — defer the bulk /release_status POST by
  // 350ms after deps change so that on back-from-details, the discover
  // focus animation lands first and the selector stays responsive.
  // Without this, returning from details fires the prewarm immediately;
  // when the response lands ~200-500ms later it triggers a re-render
  // burst that blocks the JS thread while the user is trying to scroll.
  // The 350ms covers the typical Android-TV slide animation duration.
  const _V305_BUILD_TAG = 'V305_PREWARM_DEFER_BUILD_TAG';
  void _V305_BUILD_TAG;
  useEffect(() => {
    const _v305_timer = setTimeout(() => {
      const ids: string[] = [];
      const seen = new Set<string>();
      const collect = (rawId: any) => {
        if (!rawId) return;
        const id = String(rawId);
        if (!id.startsWith('tt')) return;
        if (seen.has(id)) return;
        seen.add(id);
        ids.push(id);
      };
      const harvest = (services: any) => {
        if (!services || typeof services !== 'object') return;
        for (const svc of Object.values(services) as any[]) {
          if (!svc) continue;
          const movies = (svc as any).movies;
          if (Array.isArray(movies)) {
            for (const m of movies) collect(m && (m.imdb_id || m.id));
          }
        }
      };
      harvest((discoverData as any)?.services);
      harvest((cachedDiscover as any)?.services);
      /* Continue Watching: only fetch release status for movies. */
      const harvestCW = (list: any) => {
        if (!Array.isArray(list)) return;
        for (const it of list) {
          if (!it) continue;
          const t = (it as any).content_type || (it as any).type;
          if (t && t !== 'movie') continue;
          collect((it as any).content_id || (it as any).imdb_id || (it as any).id);
        }
      };
      harvestCW(continueWatching);
      harvestCW(cachedCW);
      if (ids.length > 0) _v167PrewarmReleaseStatus(ids);
    }, 350);
    return () => clearTimeout(_v305_timer);
  }, [discoverData, cachedDiscover, continueWatching, cachedCW]);

  // PATCH_V47_FOCUS_THROTTLE + V181_DISCOVER_THROTTLE — same throttle but
  // backed by a module-scope timestamp (see top of file) so the cooldown
  // survives unmount/remount.  Previously the useRef was component-scoped
  // → every back-nav reset the clock → every back-nav re-fetched → 1-3 s
  // JS-thread freeze on the D-pad.  Module scope = real persistence.
  const lastDiscoverFetchTime = { get current(){ return _v181_lastDiscoverFetch; }, set current(v: number){ _v181_lastDiscoverFetch = v; } };
  useFocusEffect(
    useCallback(() => {
      const now = Date.now();
      const cwElapsed = now - lastCWFetchTime.current;
      const discoverElapsed = now - lastDiscoverFetchTime.current;
      // Always cheap CW refresh after 30s; only heavy discover refresh after 60s.
      if (cwElapsed < 30000 && discoverElapsed < 60000) {
        return; // recent enough — back-nav stays instant
      }
      const handle = InteractionManager.runAfterInteractions(() => {
        if (cwElapsed >= 30000) fetchContinueWatching();
        if (discoverElapsed >= 60000) {
          lastDiscoverFetchTime.current = Date.now();
          fetchDiscover(); // no force flag — SWR pattern from store
        }
      });
      return () => handle.cancel();
    }, [fetchContinueWatching])
  );

  // Check if there's any content to display
  // PATCH_V144_CACHE_HASCONTENT — prefer live data, fall back to cached snapshot
  const hasContent = useMemo(() => {
    const services = discoverData?.services || cachedDiscover?.services;
    if (!services) return false;
    return Object.values(services).some(
      (content: any) => 
        (content?.movies?.length > 0) || 
        (content?.series?.length > 0) || 
        (content?.channels?.length > 0)
    );
  }, [discoverData, cachedDiscover]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      fetchAddons(),
      fetchDiscover(),
      fetchContinueWatching(),
    ]);
    setRefreshing(false);
  }, [fetchContinueWatching]);

  // Handle section focus - scroll parent to show category title
  // v211 discover clean — throttled focus + top-third framing
  const _v211FocusCooldown = useRef<number>(0);
  const _v211PendingFrame = useRef<number | null>(null);
  // V278_CW_SNAPBACK — millisecond timestamp until which the ScrollView's
  // onScroll handler will actively snap any y>0 scroll back to 0.  Engaged
  // whenever the CW section receives focus.  500ms is enough to cover
  // Android TV's `requestRectangleOnScreen` animation cycle.
  const cwFocusLockUntilRef = useRef<number>(0);
  const handleSectionFocus = useCallback((sectionKey: string) => {
    // V279_DIAG — trace every section focus event with timestamp + current
    // scroll position so we can see whether the FIRST UP press is even
    // calling this for the CW row.
    console.log('[V279_DIAG] handleSectionFocus key=' + sectionKey + ' t=' + Date.now());
    if (_v211PendingFrame.current != null) {
      cancelAnimationFrame(_v211PendingFrame.current);
      _v211PendingFrame.current = null;
    }
    const sectionY = sectionPositions.current[sectionKey];
    console.log('[V279_DIAG]   sectionY=' + sectionY + ' lastFocusedSection=' + lastFocusedSection.current);
    if (sectionY === undefined || !scrollViewRef.current) return;
    const target = Math.max(0, sectionY - 12);
    scrollViewRef.current.scrollTo({ y: target, animated: false });
    console.log('[V279_DIAG]   scrollTo(' + target + ')');
    // V277_CW_SNAP_HARDER — v238g only retried ONCE at 50ms which left the
    // CW row "halfway up" because Android TV's `requestRectangleOnScreen`
    // fires AFTER our scroll and re-positions to "just visible".  Now:
    // four retries spread across the next ~320ms (0, 80, 180, 320) so we
    // win the race even on slow Firestick frames.  Only fires for the
    // top row (target === 0) — other rows are unaffected.
    if (target === 0) {
      // V278_CW_SNAPBACK — engage 500ms onScroll lock so any system-driven
      // re-scroll during this window is force-snapped back to y=0.
      cwFocusLockUntilRef.current = Date.now() + 500;
      const _snap = () => {
        if (scrollViewRef.current) {
          scrollViewRef.current.scrollTo({ y: 0, animated: false });
        }
      };
      setTimeout(_snap, 0);
      setTimeout(_snap, 80);
      setTimeout(_snap, 180);
      setTimeout(_snap, 320);
    }
    lastFocusedSection.current = sectionKey;
  }, []);

  // Row sync: keep all rows scrolled to the same horizontal offset
  // (No longer needed — removed carousel anchor scrolling)

  // Item width for snap scrolling
  const itemWidth = POSTER_WIDTH + 16;

  // PATCH_V47_FOCUS_DEBOUNCE — debounce 350ms so rapid D-pad scrolling does NOT spam getMeta.
  // Previously: 50 cards scrolled = 50 HTTP requests. Now: prefetch only fires
  // if the user actually pauses on a poster for >350ms.
  const prefetchingRef = useRef<Set<string>>(new Set());
  const focusDebounceTimerRef = useRef<any>(null);
  const pendingFocusItemRef = useRef<ContentItem | null>(null);
  /* v138-stream-prefetch */
  // Second-tier prefetch: at 900ms of stable focus on a MOVIE poster,
  // kick off /api/streams.  Lands in both the content-store cache AND
  // the server-side 2-min cache, so the eventual click is a cache hit.
  const streamPrefetchingRef = useRef<Set<string>>(new Set());
  const streamPrefetchTimerRef = useRef<any>(null);
  const fetchStreamsForPrefetch = useContentStore(s => s.fetchStreams);
  const handleItemFocus = useCallback((item: ContentItem) => {
    pendingFocusItemRef.current = item;
    if (focusDebounceTimerRef.current) clearTimeout(focusDebounceTimerRef.current);
    if (streamPrefetchTimerRef.current) clearTimeout(streamPrefetchTimerRef.current);
    focusDebounceTimerRef.current = setTimeout(() => {
      focusDebounceTimerRef.current = null;
      const it = pendingFocusItemRef.current;
      if (!it) return;
      const id = it.imdb_id || it.id;
      if (!id || prefetchingRef.current.has(id) || getMetaCache(id)) return;
      prefetchingRef.current.add(id);
      api.content.getMeta(it.type, id).then((meta) => {
        setMetaCache(id, meta);
        if (meta.background) {
          try { Image.prefetch(meta.background); } catch (_) {}
        }
      }).catch(() => {});
    }, 350);
    // v138: stream prefetch on extended focus.  Movies only -- series
    // posters land on the series root (no stream fetch there).
    streamPrefetchTimerRef.current = setTimeout(() => {
      streamPrefetchTimerRef.current = null;
      const it = pendingFocusItemRef.current;
      if (!it) return;
      if (it.type !== 'movie') return;
      const id = it.imdb_id || it.id;
      if (!id || streamPrefetchingRef.current.has(id)) return;
      streamPrefetchingRef.current.add(id);
      console.log('[PREFETCH v138] kicking /api/streams for focused movie', id);
      try {
        fetchStreamsForPrefetch(it.type, id);
      } catch (e) {
        console.log('[PREFETCH v138] failed', e);
      }
    }, 900);
  }, [fetchStreamsForPrefetch]);

  // PATCH_V54_VIRTUALIZE — progressive: 6 services first, expand after 700ms.
 const [maxRowsV54, setMaxRowsV54] = useState(6); // PATCH_V54_FLATROWS

useEffect(() => {
  const t = setTimeout(() => setMaxRowsV54(999), 700);
  return () => clearTimeout(t);
}, []);

// Build flattened rows safely (optimized)
const flatRowsV54 = useMemo(() => {
  const rows: any[] = [];

  // PATCH_V144_CACHE_FLATROWS — prefer live data, fall back to cached snapshot
  const services = discoverData?.services || cachedDiscover?.services;
  if (!services || typeof services !== 'object') {
    return rows;
  }

  const cwSource = (continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW;

  // Continue Watching row (constant identity, no recalculation logic)
  if (cwSource?.length > 0) {
    rows.push({ key: '__cw__', kind: 'cw' });
  }

  let rIdx = 0;

  const entries = Object.entries(services);

  for (let i = 0; i < entries.length; i++) {
    const [sName, c]: any = entries[i];
    if (!c) continue;

    const lname = (sName || '').toLowerCase();

    const hasMov = lname.includes('movie');
    const hasSer = lname.includes('series');
    const hasCh = lname.includes('channel');

    const movies = c.movies;
    const series = c.series;
    const channels = c.channels;

    if (movies?.length) {
      rows.push({
        key: `${sName}|m`,
        kind: 'row',
        serviceName: sName,
        contentType: 'movies',
        items: movies,
        title: hasMov ? sName : `${sName} Movies`,
        rowIdx: rIdx++,
      });
    }

    if (series?.length) {
      rows.push({
        key: `${sName}|s`,
        kind: 'row',
        serviceName: sName,
        contentType: 'series',
        items: series,
        title: hasSer ? sName : `${sName} Series`,
        rowIdx: rIdx++,
      });
    }

    if (channels?.length) {
      rows.push({
        key: `${sName}|c`,
        kind: 'row',
        serviceName: sName,
        contentType: 'channels',
        items: channels.map((ch: any) => ({
          ...ch,
          type: 'tv' as const,
        })),
        title: hasCh ? sName : `${sName} Channels`,
        rowIdx: rIdx++,
      });
    }
  }

  return rows.slice(0, 1 + maxRowsV54);
  // PATCH_V144_CACHE_DEPS — re-evaluate when cached fallback hydrates
}, [discoverData?.services, cachedDiscover?.services, continueWatching, cachedCW, maxRowsV54]);

// PATCH_V241_DEFER_FLATROWS — deprioritise the heavy row-mapping render so the
// JS thread stays free for navigation taps/D-pad on low-CPU devices like
// Firestick.  React keeps the previous deferred value visible while the new
// one is computed in the background.
const deferredFlatRows = useDeferredValue(flatRowsV54);

// Navigation handler (kept minimal for speed)
const handleItemPress = useCallback((item: ContentItem) => {
  const id = item.imdb_id || item.id;
  if (!id) return;

  router.push({
    pathname: `/details/${item.type}/${encodeURIComponent(id)}`,
    params: {
      // v238 — pass everything the details page needs to paint INSTANTLY
      // so the user never sees a black screen + generic "Loading..." text.
      name: item.name || '',
      poster: item.poster || '',
      background: (item as any).background || (item as any).backdrop || '',
      logo: (item as any).logo || '',
    },
  });
}, [router]);

  // Handle continue watching item press
  // PATCH_V147_NO_STALE_URL — never trust a saved Premiumize URL/infoHash
  // from yesterday.  Always route through Details which does a fresh
  // /api/streams fetch + v141 sort + v146 audio penalty + autoPlay.
  const handleContinueWatchingPress = (item: WatchProgress) => {
    let targetId = item.content_id;
    let targetType = item.content_type;
    
    // v238b — for series CW, navigate DIRECTLY to the episode page so
    // /api/streams returns the episode's streams and autoplay fires.
    // Previously this code stripped ":1:1" and navigated to the series
    // ROOT — but the series root has zero streams, so autoPlay never
    // triggered.  Result was "click CW series item → no playback".
    //
    // We still expose series_id (if present) but build the URL with the
    // full episode-qualified content_id.
    if (item.series_id) {
      targetType = 'series';
      // If content_id already encodes ":season:episode", use it as-is.
      // Otherwise build from series_id + season/episode fields.
      if (item.content_id && item.content_id.includes(':')) {
        targetId = item.content_id;
      } else if (item.season != null && item.episode != null) {
        targetId = `${item.series_id}:${item.season}:${item.episode}`;
      } else {
        targetId = item.series_id;
      }
    }
    // If content_id is already in tt12345:1:1 form, leave it — that's
    // exactly the episode-page URL the details screen expects.
    
    const encodedId = encodeURIComponent(targetId);
    // PATCH_V147_AUTOPLAY — let details fire its built-in autoPlay path so
    // the user lands directly on playback after a fresh stream fetch.
    router.push({
      pathname: `/details/${targetType}/${encodedId}`,
      params: {
        name: item.title || '',
        poster: item.poster || '',
        resumeEpisodeId: item.content_type === 'series' ? item.content_id : '',
        resumePosition: String(item.progress || 0),
        // v238b — was `item.season !== undefined` which let `null` slip
        // through, then String(null) became the literal string "null"
        // and details showed "Episode null".  Use loose != to catch both.
        resumeSeason: (item.season != null) ? String(item.season) : '',
        resumeEpisode: (item.episode != null) ? String(item.episode) : '',
        autoPlay: 'true',
      },
    });
  };

  // Handle removing item from continue watching
  const handleRemoveFromContinueWatching = async (item: WatchProgress) => {
    // V275_CW_INSTANT_REMOVE_FIX — was using stale closure values
    // of continueWatching/cachedCW captured by the memoized
    // renderContinueWatchingItem (dep array [isTV] never invalidated).
    // The check evaluated 0===0 && 0===0 → true → ALL rows hidden after
    // removing just 1.  Now: use functional updaters so the next-state
    // values are computed from the LATEST state, and only flip the
    // force-hidden gate once we've confirmed both lists are actually
    // empty.
    try {
      LayoutAnimation.configureNext({
        duration: 120,
        update: { type: LayoutAnimation.Types.easeInEaseOut },
        delete: {
          type: LayoutAnimation.Types.easeInEaseOut,
          property: LayoutAnimation.Properties.opacity,
        },
      });
    } catch (_) {}

    let nextLive: WatchProgress[] = [];
    let nextCached: WatchProgress[] = [];
    setContinueWatching(prev => {
      nextLive = (prev || []).filter(i => i.content_id !== item.content_id);
      return nextLive;
    });
    setCachedCW(prev => {
      nextCached = (prev || []).filter(i => i.content_id !== item.content_id);
      return nextCached;
    });

    // Only hide the entire row if BOTH the live AND cached lists are
    // empty after this removal.  Computed from the functional-updater
    // results above, so it's correct regardless of closure staleness.
    if (nextLive.length === 0 && nextCached.length === 0) {
      setCwForceHidden(true);
    }

    // Then delete from server in background (don't await)
    api.watchProgress.delete(item.content_id).catch(err => {
      console.log('[Discover] Error removing from continue watching:', err);
      // Optionally: restore the item if delete fails
    });
  };

// Render a continue watching item (Stremio style)
const renderContinueWatchingItem = useCallback(
  ({ item }: { item: WatchProgress }) => (
    <ContinueWatchingItem
      item={item}
      posterWidth={POSTER_WIDTH}
      posterHeight={POSTER_HEIGHT}
      isTV={isTV}
      onPress={() => handleContinueWatchingPress(item)}
      onRemove={() => handleRemoveFromContinueWatching(item)}
      onSectionFocus={() => handleSectionFocus('__cw__')}
    />
  ),
  [isTV]
);

// Show loading only on initial load
// PATCH_V144_CACHE_SPINNER — skip the spinner entirely if we have a cached snapshot
// V275_REVERT_SKELETON — user feedback: the LogoSkeleton looked off (layout
// didn't match real Discover).  Going back to a bare ActivityIndicator.
// V276_HOLD_SPINNER_TILL_POSTERS — also keep spinner up while the top-row
// posters are still warming the expo-image cache, so the play interface
// never appears with blank cards.  Cached-data boots skip this check
// (since posters are usually already on disk from a previous session).
if (
  (isLoadingDiscover || (!cachedDiscover && !postersReady))
  && !discoverData
  && !cachedDiscover
) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* V176K_POPOVER_MOUNTED — Stremio-style menu host for this screen. */}
      <V176kPopover />
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    </SafeAreaView>
  );
}
// V276_HOLD_SPINNER_TILL_POSTERS — even after fresh data arrives, hold
// the spinner one more pass if the prefetch hasn't resolved yet AND we
// don't have a cached snapshot to paint from.
if (discoverData && !cachedDiscover && !postersReady) {
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <V176kPopover />
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    </SafeAreaView>
  );
}

return (
  <SafeAreaView style={styles.container} edges={['top']}>
    {/* Welcome Screen - No Addons and No Continue Watching */}
    {/* PATCH_V144_CACHE_WELCOME — also consider cached CW so we don't flash "No Addons" */}
    {!hasContent && continueWatching.length === 0 && cachedCW.length === 0 && !isLoadingDiscover ? (
      <View style={{ flex: 1 }}>
        {/* Logo Header - always visible */}
        <View style={[styles.logoHeader, isTV && styles.logoHeaderTV]}>
          <Image
            source={require('../../assets/images/logo_header.png')}
            style={[styles.logoImage, isTV && styles.logoImageTV]}
            contentFit="contain"
          />

          <Text style={[styles.logoText, isTV && styles.logoTextTV]}>
            Privastream Cinema
          </Text>
        </View>

        <View style={styles.welcomeContainer}>
          <Ionicons
            name="extension-puzzle-outline"
            size={64}
            color={colors.primary}
          />

          <Text style={[styles.welcomeTitle, isTV && styles.welcomeTitleTV]}>
            No Addons Installed
          </Text>

          <Text style={[styles.welcomeSubtext, isTV && styles.welcomeSubtextTV]}>
            Install addons to start streaming
          </Text>

          <GoToAddonsButton router={router} isTV={isTV} />
        </View>
      </View>
    ) : (
      <View style={{ flex: 1 }}>
        {/* Fixed Logo Header */}
        <View style={[styles.logoHeader, isTV && styles.logoHeaderTV]}>
          <Image
            source={require('../../assets/images/logo_header.png')}
            style={[styles.logoImage, isTV && styles.logoImageTV]}
            contentFit="contain"
          />

          <Text style={[styles.logoText, isTV && styles.logoTextTV]}>
            Privastream Cinema
          </Text>
        </View>

        {/* Scrollable Content */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          removeClippedSubviews={true}
          // v213 bottom + prefetch — stop the over-scroll past the last row.
          // Without these the ScrollView happily flies into empty space below
          // the bottom row, which also confuses Android-TV focus search.
          contentContainerStyle={styles._v213ScrollPad}
          overScrollMode="never"
          bounces={false}
          // V278_CW_SNAPBACK — Android TV's `requestRectangleOnScreen`
          // animates the scroll over multiple frames AFTER our manual
          // scrollTo(0) resolves.  So even with multi-retry from v277,
          // the system can drag the scroll position back to e.g. y=80
          // mid-animation.  Solution: while a CW focus event is active
          // (cwFocusLockUntilRef), intercept every onScroll and snap
          // back to y=0 if the system tries to push it down.
          onScroll={(e) => {
            const y = e.nativeEvent?.contentOffset?.y ?? 0;
            const lockUntil = cwFocusLockUntilRef.current || 0;
            const inLock = Date.now() < lockUntil;
            if (y > 0) {
              console.log('[V279_DIAG] onScroll y=' + y.toFixed(1) + ' inLock=' + inLock + ' t=' + Date.now());
            }
            if (inLock && y > 0 && scrollViewRef.current) {
              scrollViewRef.current.scrollTo({ y: 0, animated: false });
              console.log('[V279_DIAG]   → SNAP BACK to 0');
            }
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        >
          {/* PATCH_V241_USE_DEFERRED — render from deferredFlatRows so heavy
              row map is non-blocking */}
          {deferredFlatRows.map((item: any) => {
            // V274_CW_INSTANT_REMOVE — bypass useDeferredValue lag: when
            // the user just cleared the last CW item, hide the row in
            // the SAME frame as the press.
            if (item.kind === 'cw' && cwForceHidden) return null;
            if (item.kind === 'cw') {
              // V108_ROW_SNAP: record CW row Y for back-scroll
              return (
                <View
                  key={item.key}
                  style={styles.section}
                  onLayout={(e) => {
                    sectionPositions.current[item.key] = e.nativeEvent.layout.y;
                  }}
                >
                  {/* V280_NON_FOCUSABLE — explicitly mark the CW header
                      View as non-focusable so Android TV's focus search
                      can't accidentally land here on the first UP press. */}
                  <View
                    style={[
                      styles.sectionHeader,
                      isTV && styles.sectionHeaderTV,
                    ]}
                    focusable={false}
                    accessible={false}
                    importantForAccessibility="no"
                  >
                    <Text
                      style={[
                        styles.sectionTitle,
                        isTV && styles.sectionTitleTV,
                      ]}
                    >
                      Continue Watching
                    </Text>
                  </View>

                  <FlatList
                    /* PATCH_V144_CACHE_CWDATA — fall back to cached CW for cold-start paint */
                    data={(continueWatching && continueWatching.length > 0) ? continueWatching : cachedCW}
                    renderItem={renderContinueWatchingItem}
                    keyExtractor={(cwItem) =>
                      String(cwItem.content_id)
                    }

                    horizontal
                    showsHorizontalScrollIndicator={false}

                    contentContainerStyle={[
                      styles.rowContent,
                      isTV && styles.rowContentTV,
                    ]}

                    removeClippedSubviews={true}
                    initialNumToRender={4}
                    maxToRenderPerBatch={4}
                    windowSize={3}
                    updateCellsBatchingPeriod={50}

                    getItemLayout={(_, index) => ({
                      length: isTV ? 320 : 220,
                      offset: (isTV ? 320 : 220) * index,
                      index,
                    })}
                  />
                </View>
              );
            }

            // V108_ROW_SNAP: wrap ServiceRow with onLayout for row Y measurement
            return (
              <View
                key={item.key}
                onLayout={(e) => {
                  sectionPositions.current[item.key] = e.nativeEvent.layout.y;
                }}
              >
                <ServiceRow
                  title={item.title}
                  serviceName={item.serviceName}
                  contentType={item.contentType}
                  /* v249 — bump cap from 15 → 100 posters per row so each
                     row feels Cinemeta-like.  ServiceRow's fetchMore still
                     kicks in beyond 100 if backend has more items.  Cold
                     boot adds ~85 ContentCards per row but React.memo on
                     the card + memoized rows keeps re-renders flat. */
                  items={(item.items || []).slice(0, 100)}
                  onItemPress={handleItemPress}
                  onItemFocus={
                    item.contentType !== 'channels'
                      ? (ci) => {
                          handleSectionFocus(item.key);
                          handleItemFocus(ci);
                        }
                      : (ci) => {
                          handleSectionFocus(item.key);
                        }
                  }
                  rowIndex={item.rowIdx}
                />
              </View>
            );
          })}

          <View style={styles.bottomPadding} />
        </ScrollView>
      </View>
    )}
  </SafeAreaView>
);
}

// Go To Addons Button (matches Addons page style)
function GoToAddonsButton({ router, isTV }: { router: any; isTV: boolean }) {
  const [isFocused, setIsFocused] = useState(false);
  
  return (
    <Pressable 
      onPress={() => router.push('/(tabs)/addons')}
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
      style={[styles.addonsButton, isFocused && styles.addonsButtonFocused]}
    >
      <Ionicons name="extension-puzzle" size={20} color={colors.primary} />
      <Text style={styles.addonsButtonText}>Install Addon</Text>
    </Pressable>
  );
}

// Continue Watching Item (Stremio style with play overlay and X on poster)
function ContinueWatchingItem({ 
  item, 
  posterWidth, 
  posterHeight, 
  isTV, 
  onPress, 
  onRemove,
  onSectionFocus,
}: { 
  item: WatchProgress; 
  posterWidth: number; 
  posterHeight: number; 
  isTV: boolean;
  onPress: () => void;
  onRemove: () => void;
  onSectionFocus?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [xFocused, setXFocused] = useState(false);
  const percentWatched = item.percent_watched || 0;

  /* V176_LONGPRESS_MENU — derive watched + progress per CW card. */
  const _v176ContentId = String((item as any).content_id || (item as any).imdb_id || (item as any).id || '');
  const [, _v176Bump] = useState(0);
  useEffect(() => _v172SubscribeWatched(() => _v176Bump((x) => (x + 1) & 0xff)), []);
  useEffect(() => _v176SubscribeProgress(() => _v176Bump((x) => (x + 1) & 0xff)), []);
  const _v176IsWatchedCW = _v172IsWatched(_v176ContentId);

  const _v176OpenMenu = useCallback(async () => {
    /* V176K_POPOVER_MOUNTED — measure poster + emit via v176 helper. */
    let anchor: any = null;
    try { anchor = await v176kMeasureAnchor(posterRef.current); } catch (_) {}
    _v176ShowLongPressMenu({
      item: {
        content_id: _v176ContentId,
        content_type: (item as any).content_type || (item as any).type || 'movie',
        title: (item as any).title,
        name: (item as any).title,
        poster: (item as any).poster || (item as any).backdrop,
      },
      inLibraryOverride: false,
      hasProgressOverride: true,
      anchor,
      onAfterChange: (action) => {
        if (action === 'cleared') { try { onRemove && onRemove(); } catch (_) {} }
      },
    });
  }, [item, _v176ContentId, onRemove]);

  /* V176B_PRESS_TIMING — TV remote OK long-press detection. */
  const _v176bLpTimer = useRef<any>(null);
  const _v176bLpFired = useRef<boolean>(false);
  const _v176bPressIn = useCallback(() => {
    _v176bLpFired.current = false;
    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);
    _v176bLpTimer.current = setTimeout(() => {
      _v176bLpFired.current = true;
      try { _v176OpenMenu(); } catch (_) {}
    }, 500);
  }, [_v176OpenMenu]);
  const _v176bPressOut = useCallback(() => {
    if (_v176bLpTimer.current) {
      clearTimeout(_v176bLpTimer.current);
      _v176bLpTimer.current = null;
    }
  }, []);
  const _v176bOnPress = useCallback(() => {
    if (_v176bLpFired.current) { _v176bLpFired.current = false; return; }
    try { onPress && onPress(); } catch (_) {}
  }, [onPress]);


  // V166_POSTER_SUB — subscribe to the canonical poster URL so this card
  // re-renders the moment an addon-row ContentCard registers the proper
  // poster for the same content_id.  Initial value uses the synchronous
  // lookup so the first paint already gets whatever is in the registry.
  const [_v166Poster, _v166SetPoster] = useState<string>(
    () => _v160GetPoster((item as any).content_id, item.poster)
  );
  useEffect(() => {
    const unsub = _v160SubscribePoster((item as any).content_id, (u: string) => _v166SetPoster(u));
    return unsub;
  }, [(item as any).content_id]);

  // V280_FIRST_CW_TAG — shared module-level reference to the first CW
  // poster's native tag.  Set by the FIRST ContinueWatchingItem (index 0)
  // after mount.  Used as nextFocusUp on first-row ContentCards so UP
  // from any non-CW row routes directly to a CW poster.
  // V279_DIAG — kept the section header trace.
  // Refs for explicit focus navigation between poster and X button
  const posterRef = useRef<View>(null);
  const xButtonRef = useRef<View>(null);
  const [posterTag, setPosterTag] = useState<number | undefined>(undefined);
  const [xButtonTag, setXButtonTag] = useState<number | undefined>(undefined);

  useEffect(() => {
    // Get native node handles after mount for nextFocusUp/Down wiring
    // findNodeHandle is not supported on web — skip entirely
    if (Platform.OS === 'web') return;
    const pTag = posterRef.current ? findNodeHandle(posterRef.current) : null;
    const xTag = xButtonRef.current ? findNodeHandle(xButtonRef.current) : null;
    if (pTag) setPosterTag(pTag);
    if (xTag) setXButtonTag(xTag);
    // V280_FIRST_CW_TAG — broadcast first-mounted CW item's tag.
    if (pTag) {
      try {
        const g: any = globalThis as any;
        if (!g.__firstCWPosterTag) {
          g.__firstCWPosterTag = pTag;
          console.log('[V280_FIRST_CW_TAG] first-mounted CW poster tag=' + pTag);
        }
      } catch (_) {}
    }
  }, []);

  const handleFocus = () => {
    console.log('[V279_DIAG] CW poster onFocus t=' + Date.now());
    setIsFocused(true);
    onSectionFocus?.();
  };

  const handleXFocus = () => {
    setXFocused(true);
    onSectionFocus?.();
  };

  const xButtonSize = isTV ? 30 : 24;
  // Total height of the X row = button size + top padding (8px)
  const xRowHeight = xButtonSize + 8;
  
  return (
    <View style={[styles.continueItem, { width: posterWidth }]}>
      {/* V176P_X_REMOVED — X overlay removed; use long-press menu. */}
      {/* Main poster - pulled up fully to overlap X button row, so X appears inside poster corner */}
      <Pressable
        ref={posterRef}
        onPress={_v176bOnPress}
        onPressIn={_v176bPressIn}
        onPressOut={_v176bPressOut}
        onLongPress={_v176OpenMenu}
        delayLongPress={500}
        onFocus={() => { try { _v173RegLP(_v176OpenMenu); } catch (_) {} handleFocus(); }}
        onBlur={() => { try { _v173RegLP(null); } catch (_) {} setIsFocused(false); }}
        android_ripple={null}
        /* V176P_X_REMOVED — nextFocusUp target gone. */
        style={[
          styles.continueImageWrapper,
          /* V176P_X_REMOVED — no more X row to overlap. */
          isFocused && styles.continueImageWrapperFocused,
        ]}
      >
        <View style={[styles.continueImageContainer, { height: posterHeight }]}>
          {/* V160_CW_USES_REGISTRY — pull the canonical poster URL from
              the registry so Continue Watching matches the addon-row
              poster for the same content.  Falls back to item.poster
              then item.backdrop when no registry entry exists yet. */}
          {/* V166_POSTER_SUB — read the subscribed canonical URL */}
          {(_v166Poster || item.backdrop) ? (
            <Image
              source={{ uri: _v166Poster || item.backdrop || '' }}
              style={styles.continueImage}
              contentFit="cover"
            />
          ) : (
            <RNImage
              source={NO_POSTER_IMAGE}
              style={styles.continueImage}
              resizeMode="cover"
            />
          )}
          
          {/* Play overlay */}
          <View style={styles.playOverlay}>
            <View style={styles.playButton}>
              <Ionicons name="play" size={isTV ? 32 : 24} color={colors.textPrimary} />
            </View>
          </View>
          
          {/* Progress bar */}
          <View style={styles.progressContainer}>
            <View style={[styles.progressBar, { width: `${Math.min(percentWatched, 100)}%` }]} />
          </View>

          {/* V176_LONGPRESS_MENU — gold check overlay when watched. */}
          {_v176IsWatchedCW && (
            <View style={styles.v176CwWatchedBadge} pointerEvents="none">
              <Ionicons name="checkmark" size={14} color="#B8A05C" />
            </View>
          )}
        </View>
      </Pressable>

      {/* Title below poster */}
      <View style={styles.continueTitleContent}>
        <Text style={styles.continueTitleText} numberOfLines={2}>
          {item.title}
        </Text>
        {item.season != null && item.episode != null && item.season > 0 && item.episode > 0 && (
          <Text style={styles.continueEpisode}>
            S{item.season} E{item.episode}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  /* V176_LONGPRESS_MENU — mirror EpisodeCard's gold checkmark for CW. */
  v176CwWatchedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
    overflow: 'visible',
  },
  // v213 — bounded bottom padding so the last row doesn't sit flush against
  // the system nav, but you also can't scroll into a blank void below it.
  _v213ScrollPad: {
    paddingBottom: 24,
  },
  bottomPadding: {
    // v238 — reduced from 100 to 16 so user can't scroll into a large
    // empty void past the last row.  The _v213ScrollPad above already
    // adds 24px of comfortable bottom margin.
    height: 16,
  },
  // Welcome Screen
  welcomeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  welcomeLogo: {
    width: 200,
    height: 100,
    marginBottom: 24,
  },
  welcomeLogoTV: {
    width: 280,
    height: 140,
  },
  welcomeText: {
    color: colors.primary,
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 8,
  },
  welcomeTextTV: {
    fontSize: 28,
  },
  welcomeTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: colors.primary,
    marginTop: 16,
  },
  welcomeTitleTV: {
    fontSize: 24,
  },
  welcomeSubtext: {
    color: colors.primary,
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
  },
  welcomeSubtextTV: {
    fontSize: 16,
  },
  addonsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 8,
    gap: 8,
    borderWidth: 3,
    borderColor: 'transparent',
    marginTop: 24,
  },
  addonsButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  addonsButtonText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  // Section styles
  section: {
    marginBottom: 32,
    overflow: 'visible',
  },
  sectionHeader: {
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  sectionHeaderTV: {
    paddingHorizontal: 48,
  },
  sectionTitle: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  sectionTitleTV: {
    fontSize: 22,
  },
  rowContent: {
    paddingHorizontal: 16,
  },
  rowContentTV: {
    paddingLeft: 48,
    paddingRight: 108,
  },
  // Continue watching item - Stremio style
  continueItem: {
    marginRight: 16,
  },
  // X button row - sits above poster, right-aligned
  xButtonRow: {
    alignItems: 'flex-end',
    zIndex: 10,
    paddingRight: 8,
  },
  continueImageWrapper: {
    borderRadius: 6,
    borderWidth: 3,
    borderColor: 'transparent',
    overflow: 'hidden',
  },
  continueImageWrapperFocused: {
    borderColor: colors.primary,
  },
  continueImageContainer: {
    backgroundColor: colors.backgroundLight,
    position: 'relative',
  },
  continueImage: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: colors.textPrimary,
  },
  progressContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  progressBar: {
    height: '100%',
    backgroundColor: colors.textPrimary,
  },
  continueTitleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  continueEpisode: {
    color: colors.primaryDark,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
  },
  continueTitleContent: {
    paddingTop: 6,
  },
  // X button overlaid on top-right of poster
  removeButtonOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  removeButtonOverlayFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.5)',
    transform: [{ scale: 1.2 }],
  },
  // Logo header
  logoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  logoHeaderTV: {
    paddingHorizontal: 48,
    paddingTop: 12,
    paddingBottom: 16,
  },
  logoImage: {
    width: 44,
    height: 44,
  },
  logoImageTV: {
    width: 64,
    height: 64,
  },
  logoText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 10,
    letterSpacing: 0.5,
  },
  logoTextTV: {
    fontSize: 24,
    marginLeft: 14,
  },
});
