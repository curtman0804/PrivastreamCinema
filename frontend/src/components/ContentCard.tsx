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

// Fallback image for missing posters
const NO_POSTER_IMAGE = require('../../assets/images/no-poster.png');

// Build backend image proxy URL for posters that fail to load directly
const getProxiedPosterUrl = (originalUrl: string): string => {
  const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || Constants.expoConfig?.extra?.backendUrl || '';
  return `${backendUrl}/api/proxy/image?url=${encodeURIComponent(originalUrl)}`;
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

export const getCardWidth = (screenWidth: number, isTV: boolean, size: string = 'medium') => {
  if (isTV) {
    const numCards = 6;
    const horizontalPadding = 80;
    const gapsBetweenCards = (numCards - 1) * 16;
    let cardWidth = (screenWidth - horizontalPadding - gapsBetweenCards) / numCards;
    return Math.min(cardWidth, 180);
  } else {
    const baseWidth = Math.min(screenWidth, 500);
    const CARD_WIDTH = (baseWidth - 48) / 3;
    return size === 'small' ? CARD_WIDTH * 0.85 : size === 'large' ? CARD_WIDTH * 1.15 : CARD_WIDTH;
  }
};

// Helper to get native tag from a ref — works on both old and new RN architectures
const getNativeTag = (ref: any): number | null => {
  if (!ref) return null;
  // Try findNodeHandle (works on old architecture)
  try {
    const tag = findNodeHandle(ref);
    if (tag && tag > 0) return tag;
  } catch (_e) {}
  // Try _nativeTag (works on both architectures)
  if (ref._nativeTag && ref._nativeTag > 0) return ref._nativeTag;
  // Try __nativeTag
  if (ref.__nativeTag && ref.__nativeTag > 0) return ref.__nativeTag;
  return null;
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
  const [isFocused, setIsFocused] = useState(false);
  const [isInLibrary, setIsInLibrary] = useState(inLibrary);
  const [posterError, setPosterError] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const pressableRef = useRef<View>(null);
  const [selfTag, setSelfTag] = useState<number>(0);
  
  const isTV = width > height || width > 800;
  const cardWidth = getCardWidth(width, isTV, size);
  const aspectRatio = posterShapes[posterShape];
  const cardHeight = cardWidth * aspectRatio;

  // Get native tag via onLayout (fires after native view is fully laid out)
  const handleLayout = useCallback(() => {
    if ((isFirstInRow || isLastInRow) && pressableRef.current) {
      const tag = getNativeTag(pressableRef.current);
      if (tag && tag !== selfTag) {
        setSelfTag(tag);
      }
    }
  }, [isFirstInRow, isLastInRow, selfTag]);

  // Also try on mount and when isFirst/isLast changes
  useEffect(() => {
    if ((isFirstInRow || isLastInRow) && pressableRef.current) {
      // Small delay to ensure native view is ready
      const timer = setTimeout(() => {
        if (pressableRef.current) {
          const tag = getNativeTag(pressableRef.current);
          if (tag && tag > 0) setSelfTag(tag);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isFirstInRow, isLastInRow]);

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
    const contentName = item.name || item.title || 'this item';
    
    Alert.alert(
      isInLibrary ? 'Remove from Library?' : 'Add to Library?',
      isInLibrary 
        ? `Remove "${contentName}" from your library?`
        : `Add "${contentName}" to your library?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isInLibrary ? 'Remove' : 'Add',
          style: isInLibrary ? 'destructive' : 'default',
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
              Alert.alert('Error', 'Failed to update library');
            }
          },
        },
      ]
    );
  }, [item, isInLibrary, onLibraryChange]);

  if (!item) return null;

  // Build focus trapping props
  const focusTrapProps: any = {};
  if (isLastInRow && selfTag > 0) {
    focusTrapProps.nextFocusRight = selfTag;
  }
  if (isFirstInRow && selfTag > 0) {
    focusTrapProps.nextFocusLeft = selfTag;
  }

  return (
    <Pressable
      ref={pressableRef}
      onPress={onPress}
      onLongPress={handleLongPress}
      delayLongPress={500}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onLayout={handleLayout}
      android_ripple={null}
      hasTVPreferredFocus={hasTVPreferredFocus}
      {...focusTrapProps}
      style={[styles.container, { width: cardWidth }]}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={item.name || item.title || 'Content'}
      accessibilityHint="Long press to add or remove from library"
    >
      {/* Poster Container - Focus border only around this */}
      <View style={[
        styles.posterContainer,
        { height: cardHeight },
        isFocused && styles.posterFocused,
      ]}>
        {/* Image or Placeholder */}
        <View style={styles.imageWrapper}>
          {item.poster && !posterError ? (
            <Image
              source={{ uri: useProxy ? getProxiedPosterUrl(item.poster) : item.poster }}
              style={styles.posterImage}
              contentFit="cover"
              recyclingKey={`${item.id || item.imdb_id}${useProxy ? '-proxy' : ''}`}
              cachePolicy="memory-disk"
              onError={() => {
                if (!useProxy && item.poster) {
                  // First failure: retry through backend proxy (bypasses CDN hotlink blocking)
                  setUseProxy(true);
                } else {
                  // Proxy also failed: show placeholder
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
        
        {/* Library indicator */}
        {isInLibrary && (
          <View style={styles.libraryBadge}>
            <Ionicons name="bookmark" size={12} color={colors.textPrimary} />
          </View>
        )}
        
        {/* Watched checkmark indicator - opposite corner from library badge (Stremio-style) */}
        {(watched || (showProgress !== undefined && showProgress >= 90)) && (
          <View style={styles.watchedBadge}>
            <Ionicons name="checkmark-circle" size={18} color="#4CAF50" />
          </View>
        )}
        
        {/* Progress bar */}
        {showProgress !== undefined && showProgress > 0 && (
          <View style={styles.progressContainer}>
            <View style={styles.progressBackground} />
            <View style={[styles.progressBar, { width: `${Math.min(showProgress, 100)}%` }]} />
          </View>
        )}
      </View>
      
      {/* Title bar - OUTSIDE poster */}
      {showTitle && (item.name || item.title) && (
        <View style={styles.titleContainer}>
          <Text style={[styles.title, isTV && styles.titleTV]} numberOfLines={2}>
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
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
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
});
