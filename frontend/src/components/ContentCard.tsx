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
} from 'react-native';

import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { ContentItem, SearchResult, api } from '../api/client';
import { useContentStore as _v169UseContentStore /* V169_FOCUS_STREAM_PREWARM */ } from '../store/contentStore';
/* V170_FOCUS_DWELL_TUNE — cap concurrent focus-prefetches so D-pad
   fly-throughs cannot saturate the JS bridge / backend.  Beyond the
   cap, prefetches are silently dropped (the on-click fetch still
   works, just without the warm-cache acceleration). */
let _v170PrefetchInflight = 0;
const _V170_PREFETCH_CAP = 2;
import { colors, posterShapes } from '../styles/colors';
import Constants from 'expo-constants';

const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');

// V160_POSTER_REGISTRY — single source of truth for posters across the app.
// First valid render per IMDb-id "wins" and all later renders (any surface:
// addon rows, search, library, continue-watching) use the same URL.  Fixes
// the case where the same content shows different posters depending on
// which screen rendered it first.
const _v160PosterRegistry: Record<string, string> = {};
// V166_POSTER_SUB — subscriber map keyed by canonical (series-level) id.
const _v166PosterSubs: Record<string, Set<(url: string) => void>> = {};
export function v160RegisterPoster(imdbId: string | undefined | null, url: string | undefined | null): void {
  if (!imdbId || !url) return;
  // strip any episode suffix like "tt1234:1:5" so episodes share the series-level poster
  const key = String(imdbId).split(':')[0];
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
  const key = String(imdbId).split(':')[0];
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
export function v160GetPoster(imdbId: string | undefined | null, fallback: string | undefined | null): string {
  if (imdbId) {
    const key = String(imdbId).split(':')[0];
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
  const [posterError, setPosterError] = useState(false);
  const [useProxy, setUseProxy] = useState(false);

  const [releaseStatus, setReleaseStatus] = useState(null);

  useEffect(() => {
    if (!item) return;
    if (item.type === 'series' || item.type === 'tv' || item.type === 'channel' || item.type === 'episode') return;
    const imdbId = item.imdb_id || item.id;
    if (!imdbId || !String(imdbId).startsWith('tt')) return;
    return _v77RequestReleaseStatus(String(imdbId), setReleaseStatus);
  }, [item]);

  const pressableRef = useRef<any>(null);

  /* V169_FOCUS_STREAM_PREWARM — dwell-timer ref so we only prefetch
     streams when the user actually lingers (>= 500ms) on a poster. */
  const _v169PrewarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  }, [onCardFocus, item]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onCardBlur?.();
    /* V169_FOCUS_STREAM_PREWARM — abort the dwell timer if the user
       moved off before 500ms; nothing to do if the prefetch already fired. */
    if (_v169PrewarmTimerRef.current) {
      clearTimeout(_v169PrewarmTimerRef.current);
      _v169PrewarmTimerRef.current = null;
    }
  }, [onCardBlur]);

  const handleLongPress = useCallback(async () => {
    const contentId = item.imdb_id || item.id;

    const contentName =
      item.name || item.title || 'this item';

    Alert.alert(
      isInLibrary
        ? 'Remove from Library?'
        : 'Add to Library?',
      isInLibrary
        ? `Remove "${contentName}" from your library?`
        : `Add "${contentName}" to your library?`,
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: isInLibrary ? 'Remove' : 'Add',
          style: isInLibrary
            ? 'destructive'
            : 'default',
          onPress: async () => {
            try {
              if (isInLibrary) {
                await api.library.remove(contentId);

                setIsInLibrary(false);
              } else {
                await api.library.add({
                  content_id: contentId,
                  content_type: item.type || 'movie',
                  name: contentName,
                  poster: item.poster || '',
                });

                setIsInLibrary(true);
              }

              onLibraryChange?.();
            } catch (error) {
              console.log('Library error:', error);

              Alert.alert(
                'Error',
                'Failed to update library'
              );
            }
          },
        },
      ]
    );
  }, [item, isInLibrary, onLibraryChange]);

  if (!item) return null;

  // HARD TV FOCUS LOCK
  const selfNode = findNodeHandle(pressableRef.current);

  // V160_USE_REGISTRY — register on first valid render, look up on every
  // render so the SAME poster URL renders no matter which surface mounted
  // this content first.
  const _v160_id = ((item as any).imdb_id || (item as any).id) as string | undefined;
  if (_v160_id && (item as any).poster) v160RegisterPoster(_v160_id, (item as any).poster as string);
  const _v160_poster = v160GetPoster(_v160_id, (item as any).poster);

  return (
    <Pressable
      ref={pressableRef}
      focusable={true}
      onPress={onPress}
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

        {(watched ||
          (showProgress !== undefined &&
            showProgress >= 90)) && (
          <View style={styles.watchedBadge}>
            <Ionicons
              name="checkmark-circle"
              size={18}
              color="#4CAF50"
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

  libraryBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colors.primary,
    borderRadius: 4,
    padding: 4,
  },

  watchedBadge: {
    position: 'absolute',
    top: 6,
    left: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 10,
    padding: 1,
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