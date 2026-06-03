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

function _v77RequestReleaseStatus(imdbId, cb) {
  if (_v77ReleaseCache.has(imdbId)) {
    cb(_v77ReleaseCache.get(imdbId));
    return () => {};
  }
  if (!_v77Subscribers.has(imdbId)) _v77Subscribers.set(imdbId, new Set());
  const subs = _v77Subscribers.get(imdbId);
  subs.add(cb);
  _v77PendingIds.add(imdbId);
  if (!_v77FlushTimer) _v77FlushTimer = setTimeout(_v77FlushBatch, 250);
  return () => {
    const s = _v77Subscribers.get(imdbId);
    if (s) s.delete(cb);
  };
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

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onCardFocus?.();
  }, [onCardFocus]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onCardBlur?.();
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