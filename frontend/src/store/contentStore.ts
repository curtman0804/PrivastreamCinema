import { create } from 'zustand'; // PATCH_V19B_ALL_DONE
import { useState, useEffect } from 'react'; // PATCH_V245_OWNERSHIP — hook deps
import AsyncStorage from '@react-native-async-storage/async-storage'; // PATCH_V19B_DISK_HELPERS
import { api, ContentItem, DiscoverResponse, Addon, LibraryResponse, SearchResult, Stream } from '../api/client';
import { getCached, setCache, CACHE_DURATIONS } from '../utils/cache';

// ============================================================
// MODULE-LEVEL CACHES — persist across screen mounts/unmounts
// These are NOT in zustand to avoid triggering re-renders
// ============================================================
const _metaCache: Record<string, ContentItem> = {};
const _streamsCache: Record<string, Stream[]> = {};

// ============================================================
// PATCH_V244_USER_SCOPE + META_DISK_CACHE
// ------------------------------------------------------------
// Three bugs fixed at once:
//
//  1. CROSS-USER BLEED: when switching test -> choyt, the old user's
//     posters briefly showed on Discover.  Root cause: AsyncStorage
//     keys ('discover_data', '@streamsCache:...', '@metaCache:...')
//     were not scoped to the logged-in user.  Now every disk key is
//     prefixed with the JWT's user_id, and the in-memory caches are
//     wiped whenever the active user changes.
//
//  2. SLOW INITIAL DETAILS PAINT: on app restart, in-memory _metaCache
//     was empty so every Details visit re-fetched the addon's
//     /meta/... endpoint (~7s on Firestick).  Now setMetaCache also
//     persists to disk (24h TTL) and a lazy hydrate loads from disk
//     on first access — so the SECOND visit of a title after app
//     restart is instant.
//
//  3. BACK-TO-DISCOVER LAG: fetchDiscover was running a full background
//     refresh on every Back from Details (network + JSON.stringify
//     comparison).  Now it only background-refreshes if data is older
//     than 60s.
//
// Auth-code-free design: we read the JWT directly from AsyncStorage
// 'auth_token' on cache access, decode user_id from the JWT payload,
// and scope from there.  No external changes required.
// ============================================================

let _v244CurrentUserId: string = '__anon__';

const _v244DecodeJwtUid = (token: string): string => {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return '__anon__';
    // base64url -> base64
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    // global.atob is provided by React Native; fall back to Buffer if needed.
    let json: string;
    try {
      // @ts-ignore — atob exists in RN
      json = atob(b64 + '==='.slice((b64.length + 3) % 4));
    } catch {
      json = global.Buffer ? global.Buffer.from(b64, 'base64').toString('utf8') : '';
    }
    const p = JSON.parse(json);
    return (p && (p.user_id || p.sub)) || '__anon__';
  } catch {
    return '__anon__';
  }
};

const _v244WipeInMemoryCaches = () => {
  for (const k of Object.keys(_metaCache)) delete _metaCache[k];
  for (const k of Object.keys(_streamsCache)) delete _streamsCache[k];
};

const _v244RefreshUserScope = async (): Promise<string> => {
  const token = await AsyncStorage.getItem('auth_token');
  const uid = token ? _v244DecodeJwtUid(token) : '__anon__';
  if (uid !== _v244CurrentUserId) {
    // User CHANGED — wipe in-memory bleed.  Zustand state is reset by
    // the caller (fetchDiscover sees the new scope and starts fresh).
    _v244WipeInMemoryCaches();
    _v244CurrentUserId = uid;
    try {
      useContentStore.getState().resetStore();
      // PATCH_V247_REACTIVE_USER — publish the NEW uid to zustand AFTER
      // resetStore (which also wipes currentUserId).  Reactive components
      // (useDiscoverData) re-render immediately with the right scope.
      useContentStore.setState({ currentUserId: uid === '__anon__' ? null : uid });
    } catch (_) {}
  } else {
    // Same user — make sure currentUserId is at least published once.
    try {
      const cur = useContentStore.getState().currentUserId;
      const want = uid === '__anon__' ? null : uid;
      if (cur !== want) useContentStore.setState({ currentUserId: want });
    } catch (_) {}
  }
  return uid;
};

const _v244Scoped = (k: string) => `${_v244CurrentUserId}:${k}`;

// Disk-backed meta cache (24h TTL)
const META_DISK_TTL_MS = 24 * 60 * 60 * 1000;
const META_DISK_KEY = (key: string) => '@metaCache:' + _v244Scoped(key);

export async function loadMetaFromDisk(key: string): Promise<ContentItem | null> {
  try {
    const raw = await AsyncStorage.getItem(META_DISK_KEY(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.time || !parsed?.data) return null;
    if (Date.now() - parsed.time > META_DISK_TTL_MS) return null;
    return parsed.data as ContentItem;
  } catch { return null; }
}

async function saveMetaToDisk(key: string, data: ContentItem): Promise<void> {
  try {
    if (!data) return;
    await AsyncStorage.setItem(
      META_DISK_KEY(key),
      JSON.stringify({ time: Date.now(), data })
    );
  } catch { /* best-effort */ }
}

// Lazy hydrate: details page can await this to get last-known meta
// while the network refresh runs in background.
export async function hydrateMetaFromDisk(key: string): Promise<ContentItem | null> {
  if (_metaCache[key]) return _metaCache[key];
  // Make sure scope is up-to-date BEFORE reading disk
  await _v244RefreshUserScope();
  const fromDisk = await loadMetaFromDisk(key);
  if (fromDisk) { _metaCache[key] = fromDisk; return fromDisk; }
  return null;
}

// Exposed for explicit logout button (kept best-effort; the scope
// switch on next login also wipes the in-memory caches).
export async function clearAllUserCaches(): Promise<void> {
  _v244WipeInMemoryCaches();
  _v244CurrentUserId = '__anon__';
}

// Discover background-refresh debounce — see fetchDiscover for use.
let _v244LastDiscoverRefresh = 0;
// PATCH_V253_DEBOUNCE — bumped 60s → 300s (5 min).  Warm-relaunch from
// background (Firestick app return-to-foreground) now never re-fetches
// Discover within 5 minutes, eliminating the brief loading flash + JSON
// stringify-diff CPU spike on back-to-Discover navigation.
const DISCOVER_REFRESH_DEBOUNCE_MS = 5 * 60 * 1000;
// ============================================================

export const getMetaCache = (key: string) => _metaCache[key] || null;
export const setMetaCache = (key: string, data: ContentItem) => {
  _metaCache[key] = data;
  // v244 — fire-and-forget disk persistence with current user scope
  saveMetaToDisk(key, data);
};
export const getStreamsCache = (key: string) => _streamsCache[key] || null;
export const setStreamsCache = (key: string, data: Stream[]) => { _streamsCache[key] = data; };

// PATCH_V19B_DISK_HELPERS — AsyncStorage-backed persistent cache (6h TTL).
const STREAMS_DISK_TTL_MS = 6 * 60 * 60 * 1000;
const STREAMS_DISK_KEY = (key: string) => '@streamsCache:' + key;
/* V170B_PREFETCH_REGISTRY — promote from a plain Set to a Map keyed by
   cacheKey, storing the in-flight promise so fetchStreams can await it
   instead of starting a duplicate parallel network call. */
const _pendingPrefetches = new Map<string, Promise<Stream[]>>();
// V190_STORE_DEF — abort token incremented on Back from Details so
// late-arriving fetch results don't clobber a successfully-rendered list.
let _v190AbortToken = 0;

async function loadStreamsFromDisk(key: string): Promise<Stream[] | null> {
  try {
    const raw = await AsyncStorage.getItem(STREAMS_DISK_KEY(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.time || !Array.isArray(parsed.streams)) return null;
    if (Date.now() - parsed.time > STREAMS_DISK_TTL_MS) return null;
    return parsed.streams as Stream[];
  } catch { return null; }
}

async function saveStreamsToDisk(key: string, streams: Stream[]): Promise<void> {
  try {
    if (!streams || streams.length === 0) return;
    await AsyncStorage.setItem(STREAMS_DISK_KEY(key), JSON.stringify({ time: Date.now(), streams }));
  } catch { /* swallow — disk cache is best-effort */ }
}

interface CurrentPlaying {
  contentType: string;
  contentId: string;
  title: string;
}

interface ContentState {
  discoverData: DiscoverResponse | null;
  // PATCH_V245_OWNERSHIP — userId that owns the current `discoverData`.
  // When the JWT user changes (warm logout -> login), this won't match
  // the live JWT scope and `useDiscoverData()` returns null, suppressing
  // the stale-poster bleed across user switches.
  discoverDataUid: string | null;
  // PATCH_V247_REACTIVE_USER — current JWT user_id in zustand so any
  // change triggers a React re-render across all subscribed components.
  // Updated by the background poller and by fetchDiscover's scope-check.
  currentUserId: string | null;
  addons: Addon[];
  library: LibraryResponse | null;
  /* V176L_LIBRARY_SET — precomputed membership Set for O(1) lookup
     by cards.  Built every time library is updated. */
  librarySet: Set<string>;
  searchResults: SearchResult[];
  searchMovies: SearchResult[];
  searchSeries: SearchResult[];
  searchHasMore: boolean;
  searchSkip: number;
  currentSearchQuery: string;
  streams: Stream[];
  selectedItem: ContentItem | null;
  currentPlaying: CurrentPlaying | null;
  isLoadingDiscover: boolean;
  isLoadingAddons: boolean;
  isLoadingLibrary: boolean;
  isLoadingSearch: boolean;
  isLoadingMoreSearch: boolean;
  isLoadingStreams: boolean;
  error: string | null;
  setSelectedItem: (item: ContentItem | null) => void;
  fetchDiscover: (forceRefresh?: boolean) => Promise<void>;
  fetchAddons: (forceRefresh?: boolean) => Promise<void>;
  fetchLibrary: (forceRefresh?: boolean) => Promise<void>;
  search: (query: string) => Promise<void>;
  loadMoreSearch: () => Promise<void>;
  fetchStreams: (type: string, id: string) => Promise<Stream[]>;
  // V199_TRUE_WIPE / V204_SOFT_NUKE
  nukeDiscoverCache: (soft?: boolean) => Promise<void>;
  // V190_STORE_DEF
  cancelInFlightStreams: () => void;
  // PATCH_V19B_INTERFACE
  prefetchStreams: (type: string, id: string) => Promise<void>;
  addToLibrary: (item: ContentItem) => Promise<void>;
  removeFromLibrary: (type: string, id: string) => Promise<void>;
  clearSearch: () => void;
  setCurrentPlaying: (info: CurrentPlaying | null) => void;
  resetStore: () => void;
}

const initialState = {
  discoverData: null,
  discoverDataUid: null as string | null, // PATCH_V245_OWNERSHIP
  currentUserId: null as string | null, // PATCH_V247_REACTIVE_USER
  addons: [],
  library: null,
  librarySet: new Set<string>(),
  searchResults: [],
  searchMovies: [],
  searchSeries: [],
  searchHasMore: false,
  searchSkip: 0,
  currentSearchQuery: '',
  currentPlaying: null,
  selectedItem: null,
  streams: [],
  isLoadingDiscover: false,
  isLoadingAddons: false,
  isLoadingLibrary: false,
  isLoadingSearch: false,
  isLoadingMoreSearch: false,
  isLoadingStreams: false,
  error: null,
  // V180_FLASH_FIX — tracks which (type/id) is currently visible so
  // refetches of the SAME show keep stale streams on screen instead
  // of flashing the list to [].
  currentStreamsKey: null as string | null,
};

export const useContentStore = create<ContentState>((set, get) => ({
  ...initialState,

  setSelectedItem: (item: ContentItem | null) => {
    set({ selectedItem: item });
  },

  resetStore: () => {
    set(initialState);
  },

  // PATCH_V55_TWO_PHASE — Stremio-style two-phase discover:
  //   1) /api/discover?limit=5  (returns in ~1-2s with first 5 services)
  //   2) background /api/discover?skip=5 to fill in the rest
  fetchDiscover: async (forceRefresh = false) => {
    // v244 — gate every fetch on current JWT user.  Switching users
    // wipes in-memory caches BEFORE we read the disk cache, so test's
    // posters can never bleed into choyt's session.
    await _v244RefreshUserScope();

    const currentData = get().discoverData;

    // Background background-refresh path (already have data)
    if (currentData && !forceRefresh) {
      // v244 — 60s debounce.  Back-from-Details used to fire a full
      // network refresh + JSON.stringify diff on every nav; on Firestick
      // that's the JS-thread freeze.  Skip if data is < 60s fresh.
      if (Date.now() - _v244LastDiscoverRefresh < DISCOVER_REFRESH_DEBOUNCE_MS) {
        return;
      }
      _v244LastDiscoverRefresh = Date.now();
      try {
        const data: any = await (api.content as any).getDiscover();
        if (data) {
          // V204_SKIP_IDENTICAL — same payload => keep the same object reference
          // so flatRows memos don't recompute and no row re-renders (this was
          // the post-back-nav D-pad freeze).
          try {
            const prev = get().discoverData;
            if (prev && JSON.stringify(prev) === JSON.stringify(data)) return;
          } catch (_) {}
          set({ discoverData: data, discoverDataUid: _v244CurrentUserId }); // v245 ownership
          // v244 — scope the disk cache key to the current user.
          setCache('discover_data:' + _v244CurrentUserId, data, CACHE_DURATIONS.MEDIUM);
        }
      } catch (err) {
        console.log('[ContentStore] Background refresh error:', err);
      }
      return;
    }

    // First open: try local cache for instant paint
    if (!currentData && !forceRefresh) {
      // v244 — read SCOPED cache so we never load the previous user's data.
      const cached = await getCached<DiscoverResponse>('discover_data:' + _v244CurrentUserId);
      if (cached) {
        set({ discoverData: cached, discoverDataUid: _v244CurrentUserId, isLoadingDiscover: false }); // v245
      }
    }

    set({ isLoadingDiscover: true, error: null });
    try {
      // PATCH_V57_FULL_FETCH — always fetch full discover (no backend pagination).
      // V54 frontend already staggers render so cold start stays fast,
      // and we need ALL addons (Streaming Catalogs especially) for proper
      // row population.
      let firstPage: any = null;
      try {
        firstPage = await (api.content as any).getDiscover();
      } catch (err) {
        console.log('[ContentStore] discover fetch failed:', err);
        throw err;
      }

      if (firstPage) {
        let identical = false; // V204_SKIP_IDENTICAL
        try {
          const prev = get().discoverData;
          identical = !!prev && JSON.stringify(prev) === JSON.stringify(firstPage);
        } catch (_) {}
        if (identical) {
          set({ isLoadingDiscover: false });
        } else {
          set({ discoverData: firstPage, discoverDataUid: _v244CurrentUserId, isLoadingDiscover: false }); // v245
          // v244 — scoped key.
          setCache('discover_data:' + _v244CurrentUserId, firstPage, CACHE_DURATIONS.MEDIUM);
        }
        _v244LastDiscoverRefresh = Date.now();
}
    } catch (error: any) {
      console.log('[ContentStore] fetchDiscover error:', error);
      set({ error: error?.message || 'discover failed', isLoadingDiscover: false, discoverData: currentData || null });
    }
  },

    fetchAddons: async (forceRefresh = false) => {
    set({ isLoadingAddons: true, error: null });
    try {
      const data = await api.addons.getAll();
      set({ addons: data || [], isLoadingAddons: false });
    } catch (error: any) {
      console.log('[ContentStore] fetchAddons error:', error);
      set({ error: error.message, isLoadingAddons: false, addons: [] });
    }
  },

  fetchLibrary: async (forceRefresh = false) => {
    set({ isLoadingLibrary: true, error: null });
    try {
      const data = await api.library.get();
      /* V176L_LIBRARY_SET — also build the membership Set so every
         subscribed ContentCard can do O(1) lookups. */
      const _v176lSet = new Set<string>();
      try {
        const _v176lArr: any[] = []
          .concat(((data as any) && (data as any).movies) || [])
          .concat(((data as any) && (data as any).series) || [])
          .concat(((data as any) && (data as any).channels) || [])
          .concat(((data as any) && (data as any).tv) || []);
        for (const it of _v176lArr) {
          const id = String((it && (it.imdb_id || it.id || it.content_id)) || '');
          if (id) _v176lSet.add(id);
        }
      } catch (_) {}
      set({ library: data, librarySet: _v176lSet, isLoadingLibrary: false });
    } catch (error: any) {
      console.log('[ContentStore] fetchLibrary error:', error);
      set({ error: error.message, isLoadingLibrary: false });
    }
  },

  search: async (query: string) => {
    if (!query.trim()) {
      set({ searchResults: [], searchMovies: [], searchSeries: [], searchHasMore: false, searchSkip: 0, currentSearchQuery: '' });
      return;
    }
    set({ isLoadingSearch: true, error: null, currentSearchQuery: query, searchSkip: 0 });
    try {
      const data = await api.content.search(query, 0, 30);
      const movies = data.movies || [];
      const series = data.series || [];
      const results = [...movies, ...series];
      set({ 
        searchResults: results, 
        searchMovies: movies,
        searchSeries: series,
        searchHasMore: data.hasMore || false,
        searchSkip: 30,
        isLoadingSearch: false 
      });
    } catch (error: any) {
      console.log('[ContentStore] search error:', error);
      set({ error: error.message, isLoadingSearch: false });
    }
  },

  loadMoreSearch: async () => {
    const { currentSearchQuery, searchSkip, searchMovies, searchSeries, isLoadingMoreSearch } = get();
    if (!currentSearchQuery || isLoadingMoreSearch) return;
    
    set({ isLoadingMoreSearch: true });
    try {
      const data = await api.content.search(currentSearchQuery, searchSkip, 30);
      const newMovies = data.movies || [];
      const newSeries = data.series || [];
      // v241 — dedup by id when appending (genre responses overlap)
      const _eM = new Set(searchMovies.map((m: any) => m.id || m.imdb_id));
      const _eS = new Set(searchSeries.map((s: any) => s.id || s.imdb_id));
      const uniqMovies = newMovies.filter((m: any) => { const k = m.id || m.imdb_id; return k ? !_eM.has(k) : true; });
      const uniqSeries = newSeries.filter((s: any) => { const k = s.id || s.imdb_id; return k ? !_eS.has(k) : true; });
      const _allDupes = uniqMovies.length === 0 && uniqSeries.length === 0 && (newMovies.length + newSeries.length) > 0;
      const _safeHasMore = _allDupes ? false : (data.hasMore || (newMovies.length >= 100 || newSeries.length >= 100));
      set({ 
        searchMovies: [...searchMovies, ...uniqMovies],
        searchSeries: [...searchSeries, ...uniqSeries],
        searchResults: [...searchMovies, ...uniqMovies, ...searchSeries, ...uniqSeries],
        searchHasMore: _safeHasMore,
        searchSkip: searchSkip + 30,
        isLoadingMoreSearch: false 
      });
    } catch (error: any) {
      console.log('[ContentStore] loadMoreSearch error:', error);
      set({ error: error.message, isLoadingMoreSearch: false });
    }
  },

  fetchStreams: async (type: string, id: string) => {
    // V190_STORE_DEF — retry-once on empty + abort-token gate + don't-clobber
    const cacheKey = `${type}/${id}`;
    const _myToken = _v190AbortToken;
    const _setIf = (patch: any) => { if (_myToken === _v190AbortToken) set(patch); };

    // 1. Memory cache — instant
    const cached = getStreamsCache(cacheKey);
    if (cached && cached.length > 0) {
      _setIf({ streams: cached, isLoadingStreams: false, error: null });
      return cached;
    }

    // 2. Mark loading + watchdog
    _setIf({ isLoadingStreams: true, streams: [], error: null });
    setTimeout(() => {
      if (get().isLoadingStreams && _myToken === _v190AbortToken) {
        console.log('[ContentStore v190] watchdog clearing isLoadingStreams after 30s');
        _setIf({ isLoadingStreams: false, error: null });
      }
    }, 30000);

    // 3. Disk cache
    const diskCached = await loadStreamsFromDisk(cacheKey);
    if (diskCached && diskCached.length > 0) {
      setStreamsCache(cacheKey, diskCached);
      _setIf({ streams: diskCached, isLoadingStreams: false, error: null });
      return diskCached;
    }

    // 4. Wait on any in-flight focus-prefetch
    const _inflight = _pendingPrefetches.get(cacheKey);
    if (_inflight) {
      try {
        const shared = await _inflight;
        if (shared && shared.length > 0) {
          setStreamsCache(cacheKey, shared);
          _setIf({ streams: shared, isLoadingStreams: false, error: null });
          return shared;
        }
      } catch (_) { /* fall through */ }
    }

    // 5. Network — with one retry on empty (3 s delay)
    try {
      // V194_PROGRESSIVE_PAINT — paint streams as each source returns
      // instead of waiting for the slowest (direct Torrentio/TPB from
      // the Firestick can take 10-12 s; the backend returns in ~6 s on
      // cold cache).  The list never shrinks; once Backend lands 5
      // streams, the user sees them immediately.  Late-arriving direct
      // sources can append more — they can't take any away.
      let allStreams: any[] = [];
      let _v241LastPaintTs = 0;
      let _v241PendingTimer: any = null;
      let _v241PendingStreams: any[] | null = null;
      const _v241PaintNow = (s: any[]) => {
        _v241LastPaintTs = Date.now();
        try { setStreamsCache(cacheKey, s); } catch (_) {}
        _setIf({ streams: s, isLoadingStreams: false });
        allStreams = s;
      };
      const _v194_onProgress = (partialStreams: any[]) => {
        if (_myToken !== _v190AbortToken) return;
        if (!partialStreams || partialStreams.length === 0) return;
        const _cur = get();
        const _curCount = (_cur && _cur.streams) ? _cur.streams.length : 0;
        if (partialStreams.length <= _curCount) return;
        const _elapsed = Date.now() - _v241LastPaintTs;
        if (_v241LastPaintTs === 0 || _elapsed >= 250) {
          if (_v241PendingTimer) { clearTimeout(_v241PendingTimer); _v241PendingTimer = null; }
          _v241PendingStreams = null;
          _v241PaintNow(partialStreams);
        } else {
          _v241PendingStreams = partialStreams;
          if (!_v241PendingTimer) {
            _v241PendingTimer = setTimeout(() => {
              _v241PendingTimer = null;
              if (_v241PendingStreams && _myToken === _v190AbortToken) {
                _v241PaintNow(_v241PendingStreams);
              }
              _v241PendingStreams = null;
            }, Math.max(0, 250 - _elapsed));
          }
        }
      };
      const result = await api.addons.getAllStreams(type, id, _v194_onProgress);
      allStreams = result.streams || allStreams;

      if ((!allStreams || allStreams.length === 0) && _myToken === _v190AbortToken) {
        console.log('[ContentStore v190] 0 streams on first try — retrying once in 3s');
        await new Promise((r) => setTimeout(r, 3000));
        if (_myToken !== _v190AbortToken) return [];
        try {
          const retry = await api.addons.getAllStreams(type, id);
          if (retry && retry.streams && retry.streams.length > 0) {
            allStreams = retry.streams;
            console.log('[ContentStore v190] retry succeeded:', allStreams.length);
          }
        } catch (e) {
          console.log('[ContentStore v190] retry threw:', e);
        }
      }

      if (allStreams.length > 0) {
        setStreamsCache(cacheKey, allStreams);
        saveStreamsToDisk(cacheKey, allStreams);
      }
      // V190_STORE_DEF — DON'T CLOBBER: if retry returned 0 but state already
      // has streams from a prior success, keep them.
      if (allStreams.length === 0) {
        const _cur = get();
        if (_cur && _cur.streams && _cur.streams.length > 0) {
          console.log('[v190] keeping', _cur.streams.length, 'existing streams (refusing 0)');
          _setIf({ isLoadingStreams: false });
          return _cur.streams;
        }
      }
      _setIf({ streams: allStreams, isLoadingStreams: false });
      return allStreams;
    } catch (error: any) {
      console.log('[ContentStore v190] fetchStreams error:', error);
      const _cur = get();
      if (_cur && _cur.streams && _cur.streams.length > 0) {
        _setIf({ isLoadingStreams: false });
        return _cur.streams;
      }
      _setIf({ streams: [], isLoadingStreams: false });
      return [];
    }
  },

  // V198_NUKE_DISCOVER / V199_TRUE_WIPE — clear EVERY discover cache layer
  nukeDiscoverCache: async (soft = false) => {
    // V204_SOFT_NUKE — soft keeps current posters on screen (no blank flash, no
    // extra Discover re-render while the user is on Addons); fresh data simply
    // replaces them when the forced refetch lands.
    try {
      if (soft) set({ discoverNukeStamp: Date.now() } as any);
      else set({ discoverData: null, isLoadingDiscover: false, discoverNukeStamp: Date.now() } as any);
    } catch (_) {}
    try {
      const AS = require('@react-native-async-storage/async-storage').default;
      const keys = await AS.getAllKeys();
      const targets = (keys || []).filter((k) => typeof k === 'string' && k.toLowerCase().indexOf('discover') !== -1);
      if (targets.length > 0) { await AS.multiRemove(targets); }
    } catch (_) {}
  },

  // V190_STORE_DEF — drop any in-flight fetch's state-writes
  cancelInFlightStreams: () => {
    _v190AbortToken++;
  },

  /* V176J_STORE_FINALLY — fetchLibrary in finally so the local cache
     re-syncs with the server even if the API call throws (e.g. a 409
     because the item is already present).  Without this, repeated
     errors leave the UI permanently stale. */
  addToLibrary: async (item: ContentItem) => {
    try {
      await api.library.add(item);
    } catch (error: any) {
      console.log('[ContentStore] addToLibrary error:', error);
      set({ error: error.message });
    } finally {
      try { await get().fetchLibrary(); } catch (_) {}
    }
  },

  removeFromLibrary: async (type: string, id: string) => {
    try {
      await api.library.remove(type, id);
    } catch (error: any) {
      console.log('[ContentStore] removeFromLibrary error:', error);
      set({ error: error.message });
    } finally {
      try { await get().fetchLibrary(); } catch (_) {}
    }
  },

  clearSearch: () => {
    set({ searchResults: [], searchMovies: [], searchSeries: [], searchHasMore: false, searchSkip: 0, currentSearchQuery: '' });
  },

  setCurrentPlaying: (info: CurrentPlaying | null) => {
    set({ currentPlaying: info });
  },
}));

// ============================================================
// PATCH_V245_OWNERSHIP — useDiscoverData() hook
// ------------------------------------------------------------
// Why: when user A logs out and user B logs in WITHOUT the app
// restarting (warm switch), zustand's `discoverData` still holds
// user A's payload.  The first render of Discover paints those
// posters BEFORE fetchDiscover's user-scope check completes.
// This hook does the check at render time using the userId we
// stamped on the data when we saved it (`discoverDataUid`).
//
// Drop-in replacement:
//   - Was:  const data = useContentStore(s => s.discoverData);
//   - Now:  const data = useDiscoverData();
// ============================================================
// ============================================================
// PATCH_V247_REACTIVE_USER — useDiscoverData() reactive edition
// ------------------------------------------------------------
// v246 used a useState seeded from a module variable — that variable
// was stale on warm logout/login because the Discover tab doesn't
// unmount between user switches.  v247 reads `currentUserId` straight
// from zustand state.  Any time `_v244RefreshUserScope` (or the
// 500 ms background poller below) updates it, EVERY subscribed
// component re-renders immediately with the right scope.
//
// Drop-in replacement (no consumer changes needed):
//   const data = useDiscoverData();
// ============================================================
export function useDiscoverData(): DiscoverResponse | null {
  const data = useContentStore(s => s.discoverData);
  const uid = useContentStore(s => s.discoverDataUid);
  const activeUid = useContentStore(s => s.currentUserId);

  // Kick a one-shot scope refresh on mount in case the poller hasn't
  // run yet (cold start).  Cheap — single AsyncStorage read.
  useEffect(() => {
    _v244RefreshUserScope().catch(() => { /* best-effort */ });
  }, []);

  // Until we KNOW who's logged in, withhold data.
  if (!activeUid) return null;
  // Data must belong to the current JWT user, full stop.
  if (uid && uid !== activeUid) return null;
  return data;
}

// ============================================================
// PATCH_V247_USER_POLLER — 500ms background poll of `auth_token`.
// Detects warm logout/login (where the Discover tab stays mounted)
// and immediately wipes + republishes the new scope so stale posters
// can NEVER paint, even for one frame.  Cost: 2 reads/sec of an
// already-hot AsyncStorage key.  Negligible on Firestick.
// ============================================================
let _v247PollerStarted = false;
function _v247StartUserPoller() {
  if (_v247PollerStarted) return;
  _v247PollerStarted = true;
  setInterval(() => {
    _v244RefreshUserScope().catch(() => { /* best-effort */ });
  }, 500);
  // Also fire one immediately on module init (covers cold-start).
  _v244RefreshUserScope().catch(() => {});
}
// Auto-start the poller as soon as this module is imported.
_v247StartUserPoller();

