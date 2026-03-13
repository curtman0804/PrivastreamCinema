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

// App icon embedded as base64 — no external file dependency
const PLACEHOLDER_ICON_URI = 'data:image/png;base64,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';


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
  hasTVPreferredFocus = false,
  isFirstInRow = false,
  isLastInRow = false,
  onCardBlur,
}) => {
  const { width, height } = useWindowDimensions();
  const [isFocused, setIsFocused] = useState(false);
  const [isInLibrary, setIsInLibrary] = useState(inLibrary);
  const [posterError, setPosterError] = useState(false);
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
              source={{ uri: item.poster }}
              style={styles.posterImage}
              contentFit="cover"
              recyclingKey={item.id || item.imdb_id}
              cachePolicy="memory-disk"
              onError={() => setPosterError(true)}
            />
          ) : (
            <View style={[styles.posterImage, { backgroundColor: '#1e1e22', justifyContent: 'center', alignItems: 'center' }]}>
              <RNImage
                source={{ uri: PLACEHOLDER_ICON_URI }}
                style={{ width: cardWidth * 0.55, height: cardWidth * 0.55 }}
                resizeMode="contain"
              />
              <Text style={{ color: 'rgba(140,120,70,0.6)', fontSize: 10, marginTop: 8, fontWeight: '600', letterSpacing: 1 }}>COMING SOON</Text>
            </View>
          )}
        </View>
        
        {/* Library indicator */}
        {isInLibrary && (
          <View style={styles.libraryBadge}>
            <Ionicons name="bookmark" size={12} color={colors.textPrimary} />
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
