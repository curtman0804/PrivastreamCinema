import React, { memo, useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  Text,
  Alert,
  findNodeHandle,
  Image as RNImage,
  DeviceEventEmitter,
  /* V176K_POPOVER — Stremio-style anchored popover. */
  /* V176L_PERF_CLEANUP marker */
  /* V176M_DIAG marker */
  /* V176N_HOST_SINGLETON marker */
  /* V176O_CLOSE_BROADCAST marker */
  Modal,
  UIManager,
  Dimensions,
  Platform,
} from 'react-native';

import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ContentItem, SearchResult, api } from '../api/client';
import { useContentStore as _v169UseContentStore /* V169_FOCUS_STREAM_PREWARM */, getMetaCache, setMetaCache } from '../store/contentStore'; // PATCH_V248_HOVER_META
/* V170_FOCUS_DWELL_TUNE — cap concurrent focus-prefetches so D-pad
   fly-throughs cannot saturate the JS bridge / backend.  Beyond the
   cap, prefetches are silently dropped (the on-click fetch still
   works, just without the warm-cache acceleration). */
let _v170PrefetchInflight = 0;
const _V170_PREFETCH_CAP = 2;
import { colors, posterShapes } from '../styles/colors';
import Constants from 'expo-constants';
/* V176_LONGPRESS_MENU — v172 referenced AsyncStorage but forgot to import it,
   so hydration silently failed and gold check never appeared.  Restored here. */
import AsyncStorage from '@react-native-async-storage/async-storage';

const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');

// V160_POSTER_REGISTRY — single source of truth for posters across the app.
// First valid render per IMDb-id "wins" and all later renders (any surface:
// addon rows, search, library, continue-watching) use the same URL.  Fixes
// the case where the same content shows different posters depending on
// which screen rendered it first.
const _v160PosterRegistry: Record<string, string> = {};
// v215 poster key uniqueness — only collapse IMDB-style ids ("tt1234:1:5")
// to the series prefix ("tt1234").  Custom addon ids like "jerktank:1" or
// "porndb:abc" are kept UNIQUE so each card in the row paints its own
// addon-supplied poster instead of all sharing the first-rendered poster.
function _v215PosterKey(id: string | undefined | null): string {
  if (!id) return '';
  const s = String(id);
  if (/^tt\d+/.test(s)) return s.split(':')[0];
  return s;
}
// V166_POSTER_SUB — subscriber map keyed by canonical (series-level) id.
const _v166PosterSubs: Record<string, Set<(url: string) => void>> = {};
export function v160RegisterPoster(imdbId: string | undefined | null, url: string | undefined | null): void {
  if (!imdbId || !url) return;
  // strip any episode suffix like "tt1234:1:5" so episodes share the series-level poster
  const key = _v215PosterKey(imdbId);
  if (!key) return;
  if (!_v160PosterRegistry[key]) {
    _v160PosterRegistry[key] = String(url);
    /* V166_POSTER_SUB — notify any subscribers (e.g. Continue Watching) */
    const subs = _v166PosterSubs[key];
    if (subs && subs.size) {
      subs.forEach(cb => { try { cb(String(url)); } catch (_) {} });
    }
  }
}
/* V166_POSTER_SUB — subscribe to canonical poster URL updates for a given id.
   Fires immediately with the current value if one exists.  Returns an
   unsubscribe function. */
export function v160SubscribePoster(imdbId: string | undefined | null, cb: (url: string) => void): () => void {
  if (!imdbId || typeof cb !== 'function') return () => {};
  const key = _v215PosterKey(imdbId);
  if (!key) return () => {};
  const existing = _v160PosterRegistry[key];
  if (existing) { try { cb(existing); } catch (_) {} }
  if (!_v166PosterSubs[key]) _v166PosterSubs[key] = new Set();
  _v166PosterSubs[key].add(cb);
  return () => {
    const s = _v166PosterSubs[key];
    if (s) { s.delete(cb); if (s.size === 0) delete _v166PosterSubs[key]; }
  };
}

/* ─────────────────────────────────────────────────────────────────────────
   V172_WATCHED_REGISTRY — movie / episode watched flag, shared across every
   poster surface (Discover, Search, Library, Continue Watching).  Single
   source of truth: AsyncStorage["privastream_watched"].  Pub/sub so a long-
   press unmark on one card updates every other visible card that shows the
   same content. */
const _V172_KEY = 'privastream_watched';
const _v172WatchedSet = new Set<string>();
const _v172Subs = new Set<() => void>();
let _v172Loaded = false;

async function _v172Load(): Promise<void> {
  if (_v172Loaded) return;
  _v172Loaded = true;
  try {
    const raw = await AsyncStorage.getItem(_V172_KEY);
    if (raw) {
      const obj = JSON.parse(raw) as Record<string, boolean>;
      Object.keys(obj).forEach((k) => { if (obj[k]) _v172WatchedSet.add(k); });
    }
  } catch (_) { /* best-effort */ }
  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });
}
/* Fire-and-forget hydration on module load. */
_v172Load();

export function v172IsWatched(contentId: string | undefined | null): boolean {
  if (!contentId) return false;
  return _v172WatchedSet.has(String(contentId));
}

export function v172SubscribeWatched(cb: () => void): () => void {
  _v172Subs.add(cb);
  /* Fire once on subscribe if hydration already completed. */
  if (_v172Loaded) { try { cb(); } catch (_) {} }
  return () => { _v172Subs.delete(cb); };
}

export async function v172UnmarkWatched(contentId: string | undefined | null): Promise<void> {
  if (!contentId) return;
  const key = String(contentId);
  _v172WatchedSet.delete(key);
  try {
    const raw = await AsyncStorage.getItem(_V172_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    delete obj[key];
    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));
  } catch (_) { /* best-effort -- in-memory delete still took effect */ }
  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });
}

/* ─────────────────────────────────────────────────────────────────────────
   V176_LONGPRESS_MENU — companion helpers to the V172 watched registry.
   Adds Mark-as-Watched (sister to UnmarkWatched), an in-memory progress
   registry (hydrated by discover.tsx from the CW fetch) so the menu can
   conditionally show "Clear Progress", and a unified Alert opener that
   every poster surface (ContentCard, LibraryCard, ContinueWatchingItem)
   delegates to so the menu wording / button set is identical everywhere. */
export async function v176MarkWatched(contentId: string | undefined | null): Promise<void> {
  if (!contentId) return;
  const key = String(contentId);
  _v172WatchedSet.add(key);
  try {
    const raw = await AsyncStorage.getItem(_V172_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    obj[key] = true;
    await AsyncStorage.setItem(_V172_KEY, JSON.stringify(obj));
  } catch (_) { /* best-effort */ }
  _v172Subs.forEach((cb) => { try { cb(); } catch (_) {} });
}

/* Progress registry — populated by discover.tsx every time CW data lands. */
const _v176ProgressSet = new Set<string>();
const _v176ProgressSubs = new Set<() => void>();
export function v176RegisterProgress(ids: Array<string | undefined | null>): void {
  _v176ProgressSet.clear();
  for (const raw of (ids || [])) {
    if (!raw) continue;
    _v176ProgressSet.add(String(raw));
  }
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
}
export function v176HasProgress(contentId: string | undefined | null): boolean {
  if (!contentId) return false;
  return _v176ProgressSet.has(String(contentId));
}
export function v176SubscribeProgress(cb: () => void): () => void {
  _v176ProgressSubs.add(cb);
  return () => { _v176ProgressSubs.delete(cb); };
}
export async function v176ClearProgress(contentId: string | undefined | null): Promise<void> {
  if (!contentId) return;
  const key = String(contentId);
  _v176ProgressSet.delete(key);
  _v176ProgressSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  try { await (api as any).watchProgress.delete(key); } catch (_) { /* best-effort */ }
}

/* Unified long-press menu used by ContentCard, LibraryCard, and
   ContinueWatchingItem so every surface shows the same wording.
   Each caller supplies the context it already knows (e.g. LibraryCard
   passes inLibrary=true). */
export function v176ShowLongPressMenu(opts: {
  item: any;
  inLibraryOverride?: boolean | null;
  hasProgressOverride?: boolean | null;
  anchor?: { x: number; y: number; width: number; height: number } | null;
  onAfterChange?: (action: 'watched' | 'unwatched' | 'cleared' | 'added' | 'removed') => void;
}): void {
  /* V176K_POPOVER — emit the open event instead of calling Alert.alert.
     Every screen that hosts a <V176kPopover /> will render the menu. */
  const { item, inLibraryOverride, hasProgressOverride, anchor, onAfterChange } = opts || ({} as any);
  if (!item) return;
  const { title, actions } = v176kBuildActions({
    item,
    inLibrary: !!inLibraryOverride,
    hasProgress: hasProgressOverride == null ? undefined : !!hasProgressOverride,
    onAfterChange,
  });
  if (!actions.length) return;
  v176kEmitOpen({ anchor: anchor || null, title, actions });
}
/* ─── V176K_POPOVER ──────────────────────────────────────────────────────
   Custom Stremio-style popover anchored to the focused poster.  Used by
   ContentCard, LibraryCard, ContinueWatchingItem, and EpisodeCard via the
   v176kEmitOpen helper below.  A single <V176kPopover /> host mounted at
   each screen root listens for the 'v176k:open' DeviceEventEmitter event
   and renders the Modal with the supplied actions + anchor rect.
──────────────────────────────────────────────────────────────────────── */

export type V176kAction = {
  id: string;
  label: string;
  icon?: string;
  destructive?: boolean;
  onPress: () => void;
};

export type V176kOpenPayload = {
  anchor?: { x: number; y: number; width: number; height: number } | null;
  title?: string;
  actions: V176kAction[];
};

export function v176kEmitOpen(payload: V176kOpenPayload): void {
  try { DeviceEventEmitter.emit('v176k:open', payload); } catch (_) {}
}

/* Helper that callers can use to build the standard action list with
   the same Stremio-style logic the Alert version used.  Centralizes the
   business rules so all surfaces stay consistent. */
export function v176kBuildActions(opts: {
  item: any;
  inLibrary: boolean;
  hasProgress?: boolean;
  includeLibrary?: boolean;        // default true; episodes set false
  includeWatchedToggle?: boolean;  // default true
  onAfterChange?: (action: 'watched' | 'unwatched' | 'cleared' | 'added' | 'removed') => void;
}): { title: string; actions: V176kAction[] } {
  const { item, inLibrary, hasProgress, onAfterChange } = opts;
  const includeLibrary = opts.includeLibrary !== false;
  const includeWatchedToggle = opts.includeWatchedToggle !== false;
  const contentId = String((item as any).content_id || (item as any).imdb_id || (item as any).id || '');
  const title = (item as any).title || (item as any).name || 'this item';
  const contentType = (item as any).content_type || (item as any).type || 'movie';
  const isWatched = v172IsWatched(contentId);
  const hasProg = hasProgress != null ? !!hasProgress : v176HasProgress(contentId);

  const actions: V176kAction[] = [];
  if (hasProg) {
    actions.push({
      id: 'clear',
      label: 'Clear Progress',
      icon: 'refresh-circle-outline',
      onPress: () => {
        // v238 — optimistic UI: fire the parent callback FIRST so the poster
        // disappears from CW instantly.  Backend sync runs in background;
        // the user-perceived "5s lag" was the awaited HTTP roundtrip.
        try { onAfterChange && onAfterChange('cleared'); } catch (_) {}
        v176ClearProgress(contentId).catch((e) => console.log('[V176K] clear failed:', e));
      },
    });
  }
  if (includeWatchedToggle) {
    if (isWatched) {
      actions.push({
        id: 'unwatch',
        label: 'Mark as Unwatched',
        icon: 'eye-off-outline',
        onPress: () => {
          // v238 — optimistic.
          try { onAfterChange && onAfterChange('unwatched'); } catch (_) {}
          v172UnmarkWatched(contentId).catch((e) => console.log('[V176K] unwatch failed:', e));
        },
      });
    } else {
      actions.push({
        id: 'watch',
        label: 'Mark as Watched',
        icon: 'checkmark-circle-outline',
        onPress: () => {
          // v238 — optimistic.
          try { onAfterChange && onAfterChange('watched'); } catch (_) {}
          v176MarkWatched(contentId).catch((e) => console.log('[V176K] watch failed:', e));
        },
      });
    }
  }
  if (includeLibrary) {
    if (inLibrary) {
      actions.push({
        id: 'remove',
        label: 'Remove from Library',
        icon: 'bookmark',
        destructive: true,
        onPress: async () => {
          try {
            const removeFn = (_v169UseContentStore as any).getState().removeFromLibrary;
            await removeFn(contentType, contentId);
          } catch (e) { console.log('[V176K] remove error:', e); }
          try { onAfterChange && onAfterChange('removed'); } catch (_) {}
        },
      });
    } else {
      actions.push({
        id: 'add',
        label: 'Add to Library',
        icon: 'bookmark-outline',
        onPress: async () => {
          try {
            const addFn = (_v169UseContentStore as any).getState().addToLibrary;
            await addFn({
              id: contentId,
              imdb_id: contentId && String(contentId).startsWith('tt') ? contentId : undefined,
              name: title,
              type: contentType,
              poster: (item as any).poster || '',
            });
          } catch (e) { console.log('[V176K] add error:', e); }
          try { onAfterChange && onAfterChange('added'); } catch (_) {}
        },
      });
    }
  }
  return { title, actions };
}

/* The popover host.  Mount ONE per screen.  When multiple are mounted,
   each receives the open event independently, but Modal renders at the
   platform root so only the top-most is visible.  This keeps things
   simple — no global coordination needed. */
export const V176kPopover: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<V176kOpenPayload | null>(null);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('v176k:open', (p: V176kOpenPayload) => {
      setPayload(p);
      setOpen(true);
    });
    const closeSub = DeviceEventEmitter.addListener('v176k:close', () => setOpen(false));
    return () => { try { sub.remove(); } catch (_) {} try { closeSub.remove(); } catch (_) {} };
  }, []);

  /* V176O_CLOSE_BROADCAST — emit instead of local-only setOpen.
     Every mounted V176kPopover listens for v176k:close, so this dismisses
     ALL instances (handles the case where Discover ContentCard's singleton
     host AND a details-screen-mounted V176kPopover are both open). */
  const dismiss = useCallback(() => {
    try { DeviceEventEmitter.emit('v176k:close'); } catch (_) {}
    setOpen(false);
  }, []);
  const runAction = useCallback((a: V176kAction) => {
    /* V176O_CLOSE_BROADCAST — broadcast so every mounted popover instance
       (not just the topmost) closes on action select.  Without this, the
       user had to press back once per stacked Modal. */
    try { DeviceEventEmitter.emit('v176k:close'); } catch (_) {}
    setOpen(false);
    // Delay slightly so the close animation can start before the action
    // triggers anything heavy (e.g. fetchLibrary).
    setTimeout(() => { try { a.onPress(); } catch (e) { console.log('[V176K] action error:', e); } }, 50);
  }, []);

  if (!open || !payload) return null;

  // Position: top-right corner of the poster, popping out RIGHT + DOWN.
  // If that clips off-screen, fall back to centering horizontally and
  // anchoring below the poster.
  const win = Dimensions.get('window');
  const POPOVER_WIDTH = 260;
  const ROW_HEIGHT = 48;
  const padding = 8;
  const popoverHeight = (payload.actions.length * ROW_HEIGHT) + (payload.title ? 36 : 0) + 12;
  let left: number;
  let top: number;
  if (payload.anchor) {
    // Start at poster's right edge minus some inset so it overlaps slightly.
    left = payload.anchor.x + Math.max(0, payload.anchor.width - 60);
    top = payload.anchor.y + 20;
    // Clamp horizontally.
    if (left + POPOVER_WIDTH > win.width - padding) {
      left = Math.max(padding, win.width - POPOVER_WIDTH - padding);
    }
    // Clamp vertically.
    if (top + popoverHeight > win.height - padding) {
      top = Math.max(padding, win.height - popoverHeight - padding);
    }
    if (top < padding) top = padding;
    if (left < padding) left = padding;
  } else {
    left = Math.floor((win.width - POPOVER_WIDTH) / 2);
    top = Math.floor((win.height - popoverHeight) / 2);
  }

  return (
    <Modal
      transparent
      visible={open}
      animationType="fade"
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      <Pressable style={v176kStyles.backdrop} onPress={dismiss}>
        <View
          style={[
            v176kStyles.popover,
            { left, top, width: POPOVER_WIDTH },
          ]}
          /* Stop press propagation so tapping inside the popover does not
             dismiss it via the backdrop. */
          onStartShouldSetResponder={() => true}
        >
          {payload.title ? (
            <Text numberOfLines={1} style={v176kStyles.title}>{payload.title}</Text>
          ) : null}
          {payload.actions.map((a, i) => (
            <V176kRow key={a.id} action={a} isFirst={i === 0} onSelect={runAction} />
          ))}
        </View>
      </Pressable>
    </Modal>
  );
};

const V176kRow: React.FC<{ action: V176kAction; isFirst: boolean; onSelect: (a: V176kAction) => void }> = ({ action, isFirst, onSelect }) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      hasTVPreferredFocus={isFirst}
      focusable={true}
      onPress={() => onSelect(action)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      android_ripple={null}
      style={[v176kStyles.row, focused && v176kStyles.rowFocused]}
    >
      {focused ? <View style={v176kStyles.focusBar} /> : null}
      {action.icon ? (
        <Ionicons
          name={action.icon as any}
          size={18}
          color={focused ? colors.primary : (action.destructive ? '#ff5757' : 'rgba(255,255,255,0.85)')}
          style={v176kStyles.rowIcon}
        />
      ) : null}
      <Text
        numberOfLines={1}
        style={[
          v176kStyles.rowLabel,
          focused && v176kStyles.rowLabelFocused,
          action.destructive && !focused && v176kStyles.rowLabelDestructive,
        ]}
      >
        {action.label}
      </Text>
    </Pressable>
  );
};

const v176kStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  popover: {
    position: 'absolute',
    backgroundColor: 'rgba(20, 22, 36, 0.97)',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(184, 160, 92, 0.35)',
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 24,
  },
  title: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    height: 48,
    position: 'relative',
  },
  rowFocused: {
    backgroundColor: 'rgba(184, 160, 92, 0.16)',
  },
  focusBar: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  rowIcon: {
    marginRight: 10,
    width: 22,
    textAlign: 'center',
  },
  rowLabel: {
    flex: 1,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '500',
  },
  rowLabelFocused: {
    color: colors.primary,
    fontWeight: '700',
  },
  rowLabelDestructive: {
    color: '#ff8080',
  },
});

/* Helper measure utility callers can use to grab a poster rect before
   emitting open.  Returns null on failure so callers can fall back to
   centered placement. */
export function v176kMeasureAnchor(ref: any): Promise<{ x: number; y: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    try {
      const handle = findNodeHandle(ref);
      if (!handle) return resolve(null);
      UIManager.measureInWindow(handle, (x: number, y: number, width: number, height: number) => {
        if (typeof x !== 'number' || isNaN(x)) return resolve(null);
        resolve({ x, y, width, height });
      });
    } catch (_) {
      resolve(null);
    }
  });
}
/* V176N_HOST_SINGLETON — v176k defined V176kPopover but never mounted it
   on any screen, so long-press emitted into the void.  This singleton
   wrapper auto-mounts ONE popover host per app instance: every
   ContentCard renders a <V176kPopoverHost/> sibling, but only the first
   to mount claims the slot and actually renders <V176kPopover/>.  When
   the owner unmounts, the next claimant takes over.  Net effect: as
   long as ANY ContentCard exists on the screen, the popover works. */
let _v176nHostClaim: string | null = null;
const _v176nHostSubs = new Set<() => void>();
function _v176nTryClaim(id: string): boolean {
  if (!_v176nHostClaim) { _v176nHostClaim = id; return true; }
  return _v176nHostClaim === id;
}
function _v176nRelease(id: string): void {
  if (_v176nHostClaim === id) {
    _v176nHostClaim = null;
    _v176nHostSubs.forEach((cb) => { try { cb(); } catch (_) {} });
  }
}
export const V176kPopoverHost: React.FC = () => {
  const idRef = useRef<string>(Math.random().toString(36).slice(2));
  const [owner, setOwner] = useState<boolean>(false);
  useEffect(() => {
    const id = idRef.current;
    if (_v176nTryClaim(id)) {
      setOwner(true);
      return () => { _v176nRelease(id); };
    }
    const recheck = () => { if (_v176nTryClaim(id)) setOwner(true); };
    _v176nHostSubs.add(recheck);
    return () => { _v176nHostSubs.delete(recheck); _v176nRelease(id); };
  }, []);
  if (!owner) return null;
  return <V176kPopover />;
};

/* ─── /V176K_POPOVER ───────────────────────────────────────────────────── */

export function v160GetPoster(imdbId: string | undefined | null, fallback: string | undefined | null): string {
  if (imdbId) {
    const key = _v215PosterKey(imdbId);
    if (key && _v160PosterRegistry[key]) return _v160PosterRegistry[key];
  }
  return fallback ? String(fallback) : '';
}

// === RELEASE_STATUS_V77E ===
// Singleton batched fetcher. Coalesces release-status requests across all
// mounted ContentCards so we send 1 batch per 250ms (up to 50 ids).
const _v77ReleaseCache = new Map();
const _v77PendingIds = new Set();
const _v77Subscribers = new Map();
let _v77FlushTimer = null;

async function _v77FlushBatch() {
  _v77FlushTimer = null;
  if (_v77PendingIds.size === 0) return;
  const ids = Array.from(_v77PendingIds).slice(0, 50);
  ids.forEach(id => _v77PendingIds.delete(id));

  const notifyAll = (status) => {
    ids.forEach(id => {
      const subs = _v77Subscribers.get(id);
      if (subs) {
        subs.forEach(cb => { try { cb(status); } catch (e) {} });
        _v77Subscribers.delete(id);
      }
    });
  };

  try {
    const backendUrl =
      process.env.EXPO_PUBLIC_BACKEND_URL ||
      Constants.expoConfig?.extra?.backendUrl ||
      '';
    const res = await fetch(`${backendUrl}/api/movie/release_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imdb_ids: ids }),
    });
    if (!res.ok) {
      notifyAll('none');
    } else {
      const data = await res.json();
      ids.forEach(id => {
        const status = (data && data[id]) || 'none';
        _v77ReleaseCache.set(id, status);
        const subs = _v77Subscribers.get(id);
        if (subs) {
          subs.forEach(cb => { try { cb(status); } catch (e) {} });
          _v77Subscribers.delete(id);
        }
      });
    }
  } catch (e) {
    notifyAll('none');
  }

  if (_v77PendingIds.size > 0 && !_v77FlushTimer) {
    _v77FlushTimer = setTimeout(_v77FlushBatch, 100);
  }
}

/* V167_RELEASE_PREWARM — ids currently in-flight via prewarm. */
const _v167InFlight = new Set();
function _v77RequestReleaseStatus(imdbId, cb) {
  if (_v77ReleaseCache.has(imdbId)) {
    cb(_v77ReleaseCache.get(imdbId));
    return () => {};
  }
  if (!_v77Subscribers.has(imdbId)) _v77Subscribers.set(imdbId, new Set());
  const subs = _v77Subscribers.get(imdbId);
  subs.add(cb);
  /* V167_RELEASE_PREWARM — if a prewarm POST already covers this id,
     just subscribe; do NOT queue a duplicate batched request. */
  if (!_v167InFlight.has(imdbId)) {
    _v77PendingIds.add(imdbId);
    if (!_v77FlushTimer) _v77FlushTimer = setTimeout(_v77FlushBatch, 250);
  }
  return () => {
    const s = _v77Subscribers.get(imdbId);
    if (s) s.delete(cb);
  };
}

/* V167_RELEASE_PREWARM — bulk-prefetch release statuses BEFORE cards
   mount.  Discover screen calls this the moment its data arrives, so
   by the time individual ContentCards subscribe the cache is already
   hot and the IN CINEMA badge paints on the same frame as the poster. */
// V188_NAV_COOLDOWN — module-scoped timestamp.  Bumped whenever any
// ContentCard's onPress fires (user is heading INTO Details).  After
// they back out (~1-3 s later) we still have ~1 s of cooldown left,
// which suppresses focus prefetches while D-pad navigation recovers.
export let _v188NavCooldownUntil = 0;
export function _v188ArmNavCooldown(ms: number = 1500): void {
  _v188NavCooldownUntil = Date.now() + Math.max(0, ms);
}

export function v167PrewarmReleaseStatus(imdbIds: string[] | undefined | null): void {
  if (!Array.isArray(imdbIds) || imdbIds.length === 0) return;
  const seen = new Set<string>();
  const todo: string[] = [];
  for (const raw of imdbIds) {
    if (!raw) continue;
    const id = String(raw);
    if (!id.startsWith('tt')) continue;
    if (_v77ReleaseCache.has(id)) continue;
    if (_v167InFlight.has(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    todo.push(id);
    _v167InFlight.add(id);
    /* Claim ownership from the regular batcher so it can't fire a
       duplicate POST for these same ids. */
    _v77PendingIds.delete(id);
  }
  if (todo.length === 0) return;

  const backendUrl =
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    (Constants as any).expoConfig?.extra?.backendUrl ||
    '';

  /* Chunk to mirror the existing 50-id batch ceiling. */
  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += 50) chunks.push(todo.slice(i, i + 50));

  chunks.forEach(async (ids) => {
    const finish = (statusForAll: string | null, data: any) => {
      ids.forEach(id => {
        const status = data ? ((data[id] as string) || 'none') : (statusForAll || 'none');
        _v77ReleaseCache.set(id, status);
        _v167InFlight.delete(id);
        const subs = _v77Subscribers.get(id);
        if (subs) {
          subs.forEach(cb => { try { (cb as any)(status); } catch (_) {} });
          _v77Subscribers.delete(id);
        }
      });
    };
    try {
      const res = await fetch(`${backendUrl}/api/movie/release_status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imdb_ids: ids }),
      });
      if (!res.ok) { finish('none', null); return; }
      const data = await res.json();
      finish(null, data);
    } catch (_) {
      finish('none', null);
    }
  });
}


const getProxiedPosterUrl = (originalUrl: string): string => {
  const backendUrl =
    process.env.EXPO_PUBLIC_BACKEND_URL ||
    Constants.expoConfig?.extra?.backendUrl ||
    '';

  return `${backendUrl}/api/proxy/image?url=${encodeURIComponent(
    originalUrl
  )}`;
};

interface ContentCardProps {
  item: ContentItem | SearchResult;
  onPress: () => void;
  onCardFocus?: () => void;
  size?: 'small' | 'medium' | 'large';
  posterShape?: 'poster' | 'landscape' | 'square';
  showTitle?: boolean;
  showProgress?: number;
  inLibrary?: boolean;
  onLibraryChange?: () => void;
  watched?: boolean;
  hasTVPreferredFocus?: boolean;
  isFirstInRow?: boolean;
  isLastInRow?: boolean;
  onCardBlur?: () => void;
}

export const getCardWidth = (
  screenWidth: number,
  isTV: boolean,
  size: string = 'medium'
) => {
  if (isTV) {
    const numCards = 6;
    const horizontalPadding = 80;
    const gapsBetweenCards = (numCards - 1) * 16;

    let cardWidth =
      (screenWidth - horizontalPadding - gapsBetweenCards) /
      numCards;

    return Math.min(cardWidth, 180);
  } else {
    const baseWidth = Math.min(screenWidth, 500);

    const CARD_WIDTH = (baseWidth - 48) / 3;

    return size === 'small'
      ? CARD_WIDTH * 0.85
      : size === 'large'
      ? CARD_WIDTH * 1.15
      : CARD_WIDTH;
  }
};

/* ─────────────────────────────────────────────────────────────────────────
   V173_TV_LONGPRESS_REGISTRY — Pressable.onLongPress is unreliable on
   Google TV / Firestick OK buttons.  Maintain a single global slot for
   the currently-focused card's long-press handler and dispatch the
   native 'longSelect' TV event into it. */
/* V176I_REF_DISPATCH — the previous v173 implementation cached a
   frozen closure here.  When the focused card setState-updated
   (e.g. isInLibrary flips after Add), the cached closure became
   stale and the next longSelect fired the old behavior.  Using a
   ref-of-ref pattern: this slot now holds a *getter* that returns
   the most recent handler.  Each ContentCard installs its own
   getter on focus and clears on blur.  Inside the card we keep a
   useRef updated by every render so the getter always returns the
   freshest closure. */
let _v173FocusedLP: (() => void) | null = null;
let _v176iLatestGetter: (() => (() => void) | null) | null = null;
try {
  /* DeviceEventEmitter is already imported at top of file. */
  /* V176F_TV_DIAG — diagnostic logs so we can SEE in logcat which TV
     key events arrive on the JS side.  Filter with:
         adb logcat -d -t 500 ReactNativeJS:V *:S | findstr V176F */
  DeviceEventEmitter.addListener('onTVKeyEvent', (evt: any) => {
    /* V176L_PERF_CLEANUP — diagnostic log removed (fired per keypress). */
    if (evt && evt.eventType === 'longSelect') {
      /* V176M_DIAG — single log per long-press (NOT per keypress) so
         we can confirm in logcat that the JS bridge received the event
         and see whether registration was active at fire-time. */
      try { console.log('[V176M] longSelect rx getter=' + !!_v176iLatestGetter + ' legacy=' + !!_v173FocusedLP); } catch (_) {}
      /* V176I_REF_DISPATCH — prefer the getter; falls back to the
         legacy slot for any callers that still set it directly. */
      let target: (() => void) | null = null;
      try { if (_v176iLatestGetter) target = _v176iLatestGetter(); } catch (_) {}
      if (!target) target = _v173FocusedLP;
      if (target) {
        /* V176L_PERF_CLEANUP — silent fast-path. */
        try { target(); } catch (e) { console.log('[V176L] dispatch error:', e); }
      } else {
        /* V176L_PERF_CLEANUP — silent. */
      }
    }
  });
} catch (_) { /* DeviceEventEmitter may not exist outside RN */ }

export function v173RegisterLongPress(fn: (() => void) | null): void {
  _v173FocusedLP = fn;
}

/* V176I_REF_DISPATCH — register a *getter* (closure-stable) that the
   dispatcher invokes at fire-time.  Callers should pass a fn that
   reads from a useRef whose .current is updated by every render. */
export function v176iRegisterGetter(get: (() => (() => void) | null) | null): void {
  _v176iLatestGetter = get;
}

const ContentCardComponent: React.FC<ContentCardProps> = ({
  item,
  onPress,
  onCardFocus,
  size = 'medium',
  posterShape = 'poster',
  showTitle = true,
  showProgress,
  inLibrary = false,
  onLibraryChange,
  watched = false,
  hasTVPreferredFocus = false,
  isFirstInRow = false,
  isLastInRow = false,
  onCardBlur,
}) => {
  const { width, height } = useWindowDimensions();

  const isTV = width > height || width > 800;

  const cardWidth = getCardWidth(width, isTV, size);

  const aspectRatio = posterShapes[posterShape];

  const cardHeight = cardWidth * aspectRatio;

  const [isFocused, setIsFocused] = useState(false);
  const [isInLibrary, setIsInLibrary] = useState(inLibrary);

  /* V176L_PERF_CLEANUP — O(1) lookup via librarySet (built once per
     library change in contentStore).  The previous v176g version
     flattened movies+series+channels+tv into a fresh array and ran
     .some() on every library change for every card.  With ~50 cards
     and ~50 items that was 2500 string comparisons per Add/Remove. */
  const _v176lLibSet = _v169UseContentStore((s: any) => s.librarySet);
  useEffect(() => {
    if (!item) return;
    const myId = String((item as any).imdb_id || (item as any).id || (item as any).content_id || '');
    if (!myId) return;
    if (!_v176lLibSet) return;
    setIsInLibrary((_v176lLibSet as Set<string>).has(myId));
  }, [_v176lLibSet, item]);
  const [posterError, setPosterError] = useState(false);
  const [useProxy, setUseProxy] = useState(false);

  const [releaseStatus, setReleaseStatus] = useState(null);

  useEffect(() => {
    if (!item) return;
    if (item.type === 'series' || item.type === 'tv' || item.type === 'channel' || item.type === 'episode') return;
    const imdbId = item.imdb_id || item.id;
    if (!imdbId || !String(imdbId).startsWith('tt')) return;
    // v238 — defer release-status fetch by 250ms so cold-boot rendering
    // of 200+ ContentCards completes BEFORE batched backend roundtrips kick
    // in.  The _v77 fetcher debounces to 250ms anyway, so this just moves
    // when the first batch fires — the # of network calls is unchanged.
    let cleanup: (() => void) | undefined;
    const t = setTimeout(() => {
      cleanup = _v77RequestReleaseStatus(String(imdbId), setReleaseStatus);
    }, 250);
    return () => {
      clearTimeout(t);
      if (cleanup) { try { cleanup(); } catch (_) {} }
    };
  }, [item]);

  const pressableRef = useRef<any>(null);

  /* V169_FOCUS_STREAM_PREWARM — dwell-timer ref so we only prefetch
     streams when the user actually lingers (>= 500ms) on a poster. */
  const _v169PrewarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // PATCH_V248_HOVER_META — 200ms META prefetch timer (separate from
  // the v169 STREAM dwell).  Fires fast so a brief D-pad pause warms
  // the addon's /meta endpoint and seeds _metaCache + disk.  When the
  // user actually clicks, Details paints instantly from memory.
  const _v248MetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onCardFocus?.();
    /* V169_FOCUS_STREAM_PREWARM — kick a 500ms dwell timer.  Only
       movies get streams prefetched (series root IDs have no usable
       streams; the v138 patch already prefetches the next episode). */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }
    // PATCH_V248_HOVER_META — clear + re-arm 200ms META prefetch timer.
    if (_v248MetaTimerRef.current) {
      clearTimeout(_v248MetaTimerRef.current);
      _v248MetaTimerRef.current = null;
    }
    {
      const _v248_t = (item as any)?.type;
      const _v248_c = (item as any)?.imdb_id || (item as any)?.id;
      if (_v248_c && (_v248_t === 'movie' || _v248_t === 'series') && !getMetaCache(_v248_c)) {
        _v248MetaTimerRef.current = setTimeout(() => {
          (api as any)?.content?.getMeta?.(_v248_t, _v248_c)
            .then((data: any) => { if (data) setMetaCache(_v248_c, data); })
            .catch(() => { /* best-effort */ });
        }, 100); // V249 — dropped 200ms → 100ms; faster hover-to-instant
      }
    }
    /* V188_NAV_COOLDOWN — if the user just backed out of a Details page,
       suppress focus prefetch for 1.2 s.  Lets the JS thread serve D-pad
       focus changes without competing with network kick-offs. */
    if (Date.now() < (_v188NavCooldownUntil as any)) return;
    const _v169_type = (item as any)?.type;
    const _v169_cid = (item as any)?.imdb_id || (item as any)?.id;
    if (_v169_cid && _v169_type === 'movie' && String(_v169_cid).startsWith('tt')) {
      /* V170_FOCUS_DWELL_TUNE — 900ms dwell + concurrency cap so D-pad
         scrolling doesn't flood the backend and the JS bridge. */
      _v169PrewarmTimerRef.current = setTimeout(() => {
        if (_v170PrefetchInflight >= _V170_PREFETCH_CAP) return;
        _v170PrefetchInflight++;
        try {
          const _v169_pf = _v169UseContentStore.getState().prefetchStreams;
          if (typeof _v169_pf === 'function') {
            const _p = _v169_pf(_v169_type, String(_v169_cid));
            if (_p && typeof (_p as any).then === 'function') {
              (_p as any).finally(() => { _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1); });
            } else {
              _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1);
            }
          } else {
            _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1);
          }
        } catch (_) {
          _v170PrefetchInflight = Math.max(0, _v170PrefetchInflight - 1);
        }
      }, 900);
    }
    /* V173_TV_LONGPRESS_REGISTRY — register this card's long-press
       handler so the global 'longSelect' listener can fire it. */
    /* V176I_REF_DISPATCH — register a getter, not the closure itself. */
    try { v176iRegisterGetter(() => _v176iLpRef.current); } catch (_) {}
    try { v173RegisterLongPress(handleLongPress); } catch (_) {}
    /* V176M_DIAG — confirm registration happened on this focus. */
    try { console.log('[V176M] focus reg id=' + String((item as any)?.imdb_id || (item as any)?.id || '?')); } catch (_) {}
  }, [onCardFocus, item, handleLongPress]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onCardBlur?.();
    /* V169_FOCUS_STREAM_PREWARM — abort the dwell timer if the user
       moved off before 500ms; nothing to do if the prefetch already fired. */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }
    // PATCH_V248_HOVER_META — also abort the 200ms META timer on blur.
    if (_v248MetaTimerRef.current) {
      clearTimeout(_v248MetaTimerRef.current);
      _v248MetaTimerRef.current = null;
    }
    /* V173_TV_LONGPRESS_REGISTRY — clear long-press registration on blur. */
    try { v176iRegisterGetter(null); } catch (_) {}
    try { v173RegisterLongPress(null); } catch (_) {}
  }, [onCardBlur]);

  const handleLongPress = useCallback(async () => {
    /* V176K_POPOVER — measure poster so the popover anchors from its
       corner instead of the centered fallback. */
    let anchor: any = null;
    try { anchor = await v176kMeasureAnchor(pressableRef.current); } catch (_) {}
    v176ShowLongPressMenu({
      item,
      inLibraryOverride: isInLibrary,
      anchor,
      onAfterChange: (action) => {
        if (action === 'added') setIsInLibrary(true);
        if (action === 'removed') setIsInLibrary(false);
        if (action === 'added' || action === 'removed') {
          try { onLibraryChange && onLibraryChange(); } catch (_) {}
        }
      },
    });
  }, [item, isInLibrary, onLibraryChange, _v172IsWatched, _v172ContentId]);

  /* V176I_REF_DISPATCH — keep a ref pointing at the freshest
     handleLongPress so the global dispatcher reads the current one
     (not a stale closure frozen at the last onFocus). */
  const _v176iLpRef = useRef<(() => void) | null>(null);
  _v176iLpRef.current = handleLongPress;

  /* V176B_PRESS_TIMING — Pressable.onLongPress is unreliable on
     Firestick / Android TV OK buttons.  Do our own timing via
     onPressIn / onPressOut so it works on touch AND TV remotes. */
  const _v176bLpTimer = useRef<any>(null);
  const _v176bLpFired = useRef<boolean>(false);
  const _v176bPressIn = useCallback(() => {
    _v176bLpFired.current = false;
    if (_v176bLpTimer.current) clearTimeout(_v176bLpTimer.current);
    _v176bLpTimer.current = setTimeout(() => {
      _v176bLpFired.current = true;
      try { handleLongPress(); } catch (_) {}
    }, 500);
    // PATCH_V249_PRESSIN_PREFETCH — fire meta prefetch IMMEDIATELY on press
    // (before the click resolves into a navigation).  This guarantees the
    // network round-trip starts ASAP even when the user clicks faster than
    // the 100ms hover dwell.  Skips if already cached.
    try {
      const _v249_t = (item as any)?.type;
      const _v249_c = (item as any)?.imdb_id || (item as any)?.id;
      if (_v249_c && (_v249_t === 'movie' || _v249_t === 'series') && !getMetaCache(_v249_c)) {
        (api as any)?.content?.getMeta?.(_v249_t, _v249_c)
          .then((data: any) => { if (data) setMetaCache(_v249_c, data); })
          .catch(() => { /* best-effort */ });
      }
    } catch (_) {}
  }, [handleLongPress, item]);
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

  if (!item) return null;

  // HARD TV FOCUS LOCK
  const selfNode = findNodeHandle(pressableRef.current);

  // V160_USE_REGISTRY — register on first valid render, look up on every
  // render so the SAME poster URL renders no matter which surface mounted
  // this content first.
  const _v160_id = ((item as any).imdb_id || (item as any).id) as string | undefined;
  if (_v160_id && (item as any).poster) v160RegisterPoster(_v160_id, (item as any).poster as string);
  const _v160_poster = v160GetPoster(_v160_id, (item as any).poster);

  /* V172_WATCHED_REGISTRY — per-card derived flag + re-render hook.
     Subscribes to the module-level set so any long-press unmark (this
     card or another instance of the same content) instantly refreshes
     the badge across every surface.
     v238 — subscriptions deferred 250ms after mount.  Cold boot
     mounts ~225 cards; firing 450 subscription effects synchronously
     was the cause of the 10s post-paint freeze. */
  const _v172ContentId = ((item as any).content_id || _v160_id) as string | undefined;
  const [, _v172Bump] = useState(0);
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const t = setTimeout(() => {
      unsub = v172SubscribeWatched(() => _v172Bump((x) => (x + 1) & 0xff));
    }, 250);
    return () => { clearTimeout(t); if (unsub) try { unsub(); } catch (_) {} };
  }, []);
  const _v172IsWatched = v172IsWatched(_v172ContentId);

  /* V176_LONGPRESS_MENU — re-render when the CW progress registry changes
     so the unified long-press menu shows the right buttons.
     v238 — also deferred 250ms (same reason as v172 above). */
  useEffect(() => {
    let unsub: (() => void) | undefined;
    const t = setTimeout(() => {
      unsub = v176SubscribeProgress(() => _v172Bump((x) => (x + 1) & 0xff));
    }, 250);
    return () => { clearTimeout(t); if (unsub) try { unsub(); } catch (_) {} };
  }, []);

  return (
    /* V176N_HOST_SINGLETON — render the popover host alongside every
       card.  Only one will actually display (singleton claim above). */
    <React.Fragment>
    <V176kPopoverHost />
    <Pressable
      ref={pressableRef}
      focusable={true}
      onPress={_v176bOnPress}
      onPressIn={_v176bPressIn}
      onPressOut={_v176bPressOut}
      onLongPress={handleLongPress}
      delayLongPress={500}
      onFocus={handleFocus}
      onBlur={handleBlur}
      android_ripple={null}
      hasTVPreferredFocus={hasTVPreferredFocus}

      nextFocusRight={
        isLastInRow && selfNode
          ? selfNode
          : undefined
      }

      nextFocusLeft={
        isFirstInRow && selfNode
          ? selfNode
          : undefined
      }

      style={[
        styles.container,
        { width: cardWidth },
      ]}

      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={
        item.name || item.title || 'Content'
      }
      accessibilityHint="Long press to add or remove from library"
    >
      <View
        style={[
          styles.posterContainer,
          { height: cardHeight },
          isFocused && styles.posterFocused,
        ]}
      >
        <View style={styles.imageWrapper}>
          {/* V160_IMAGE_SWAPPED — use registry-resolved poster URL */}
          {_v160_poster && !posterError ? (
            <Image
              source={{
                uri: useProxy
                  ? getProxiedPosterUrl(_v160_poster)
                  : _v160_poster,
              }}
              style={styles.posterImage}
              contentFit="cover"
              recyclingKey={`${
                item.id || item.imdb_id
              }${useProxy ? '-proxy' : ''}`}
              cachePolicy="memory-disk"
              onError={() => {
                if (!useProxy && item.poster) {
                  setUseProxy(true);
                } else {
                  setPosterError(true);
                }
              }}
            />
          ) : (
            <RNImage
              source={NO_POSTER_IMAGE}
              style={styles.posterImage}
              resizeMode="cover"
            />
          )}
        </View>

        {isInLibrary && (
          <View style={styles.libraryBadge}>
            <Ionicons
              name="bookmark"
              size={12}
              color={colors.textPrimary}
            />
          </View>
        )}

        {/* V172_WATCHED_REGISTRY — also show the badge when our cross-surface
            registry says this content_id is watched, even if no `watched`
            prop was passed from the parent (Discover rows, Search, Library). */}
        {(watched || _v172IsWatched ||
          (showProgress !== undefined &&
            showProgress >= 90)) && (
          <View style={styles.watchedBadge}>
            {/* V172B_GOLD_CHECKMARK — match EpisodeCard's gold checkmark exactly */}
            <Ionicons
              name="checkmark"
              size={14}
              color="#B8A05C"
            />
          </View>
        )}

        {releaseStatus === 'in_cinemas' && (
          <View style={styles.inCinemasBadgeWrap} pointerEvents="none"><View style={styles.inCinemasBadgePill}>
            <Ionicons name="ticket" size={10} color={colors.textPrimary} style={styles.inCinemasBadgeIcon} /><Text style={styles.inCinemasBadgeText}>IN CINEMA</Text></View>
          </View>
        )}

        {showProgress !== undefined &&
          showProgress > 0 && (
            <View style={styles.progressContainer}>
              <View
                style={styles.progressBackground}
              />

              <View
                style={[
                  styles.progressBar,
                  {
                    width: `${Math.min(
                      showProgress,
                      100
                    )}%`,
                  },
                ]}
              />
            </View>
          )}
      </View>

      {showTitle &&
        (item.name || item.title) && (
          <View style={styles.titleContainer}>
            <Text
              style={[
                styles.title,
                isTV && styles.titleTV,
              ]}
              numberOfLines={2}
            >
              {item.name || item.title}
            </Text>
          </View>
        )}
    </Pressable>
    </React.Fragment>
  );
};

export const ContentCard = memo(ContentCardComponent);

const styles = StyleSheet.create({
  container: {
    marginRight: 16,
    marginBottom: 2,
  },

  posterContainer: {
    borderRadius: 6,
    overflow: 'visible',
    backgroundColor: colors.backgroundLight,
    position: 'relative',
    borderWidth: 3,
    borderColor: 'transparent',
  },

  posterFocused: {
    borderColor: colors.primary,
  },

  imageWrapper: {
    width: '100%',
    height: '100%',
    borderRadius: 4,
    overflow: 'hidden',
  },

  posterImage: {
    width: '100%',
    height: '100%',
    backgroundColor: colors.backgroundLight,
  },

  /* V176H_BOOKMARK_POSITION — moved from top-right to bottom-right so it
     doesn't collide with the IN CINEMA badge that sits top-left/center. */
  libraryBadge: {
    position: 'absolute',
    bottom: 8,
    right: 8,
    backgroundColor: colors.primary,
    borderRadius: 4,
    padding: 4,
    zIndex: 6,
    elevation: 6,
  },

  /* V172B_GOLD_CHECKMARK — mirror EpisodeCard's 24x24 round badge */
  watchedBadge: {
    position: 'absolute',
    top: 4,
    left: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    borderRadius: 12,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },

  progressContainer: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    height: 4,
    borderRadius: 4,
    overflow: 'hidden',
  },

  progressBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.textPrimary,
    opacity: 0.3,
  },

  progressBar: {
    height: '100%',
    backgroundColor: colors.textPrimary,
    borderRadius: 4,
  },

  titleContainer: {
    paddingTop: 6,
    paddingHorizontal: 4,
    height: 38,
  },

  title: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 16,
  },

  titleTV: {
    fontSize: 13,
  },

  inCinemasBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderTopLeftRadius: 3,
    borderBottomRightRadius: 6,
    zIndex: 5,
    elevation: 5,
  },

  inCinemasBadgeWrap: {
    position: 'absolute',
    top: 6,
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 5,
    elevation: 5,
  },

  inCinemasBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 4,
  },

  inCinemasBadgeIcon: {
    marginRight: 4,
  },

  inCinemasBadgeText: {
    color: colors.textPrimary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
});