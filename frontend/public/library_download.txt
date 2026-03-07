import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Pressable,
  useWindowDimensions,
  Alert,
  findNodeHandle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useContentStore } from '../../src/store/contentStore';
import { ContentItem } from '../../src/api/client';
import { colors } from '../../src/styles/colors';
import { getCardWidth } from '../../src/components/ContentCard';

type FilterType = 'movies' | 'series' | 'tv';

// Helper to get native tag
const getNativeTag = (ref: any): number | null => {
  if (!ref) return null;
  try {
    const tag = findNodeHandle(ref);
    if (tag && tag > 0) return tag;
  } catch (_e) {}
  if (ref._nativeTag && ref._nativeTag > 0) return ref._nativeTag;
  if (ref.__nativeTag && ref.__nativeTag > 0) return ref.__nativeTag;
  return null;
};

// Library card with X button (same pattern as Continue Watching)
const LibraryCard = React.memo(({
  item,
  onPress,
  onRemove,
  cardWidth,
  cardHeight,
  isTV,
  isFirstInRow,
  isLastInRow,
  onCardBlur,
}: {
  item: ContentItem;
  onPress: () => void;
  onRemove: () => void;
  cardWidth: number;
  cardHeight: number;
  isTV: boolean;
  isFirstInRow?: boolean;
  isLastInRow?: boolean;
  onCardBlur?: () => void;
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [xFocused, setXFocused] = useState(false);
  const posterRef = useRef<View>(null);
  const xButtonRef = useRef<View>(null);
  const [posterTag, setPosterTag] = useState<number>(0);
  const [xButtonTag, setXButtonTag] = useState<number>(0);
  const selfTagRef = useRef<number>(0);

  const xButtonSize = isTV ? 28 : 22;
  const xRowHeight = xButtonSize + 8;

  const handlePosterLayout = useCallback(() => {
    if (posterRef.current) {
      const tag = getNativeTag(posterRef.current);
      if (tag) {
        setPosterTag(tag);
        selfTagRef.current = tag;
      }
    }
  }, []);

  const handleXLayout = useCallback(() => {
    if (xButtonRef.current) {
      const tag = getNativeTag(xButtonRef.current);
      if (tag) setXButtonTag(tag);
    }
  }, []);

  const handlePosterFocus = useCallback(() => {
    setIsFocused(true);
  }, []);

  const handlePosterBlur = useCallback(() => {
    setIsFocused(false);
    onCardBlur?.();
  }, [onCardBlur]);

  // Build focus trapping props for first/last
  const focusTrapProps: any = {};
  if (isLastInRow && selfTagRef.current > 0) {
    focusTrapProps.nextFocusRight = selfTagRef.current;
  }
  if (isFirstInRow && selfTagRef.current > 0) {
    focusTrapProps.nextFocusLeft = selfTagRef.current;
  }

  return (
    <View style={{ width: cardWidth, marginRight: 16 }}>
      {/* X button row - ABOVE poster, right-aligned */}
      <View style={[styles.xButtonRow, { paddingTop: 8 }]}>
        <Pressable
          ref={xButtonRef}
          onPress={onRemove}
          onFocus={() => setXFocused(true)}
          onBlur={() => setXFocused(false)}
          onLayout={handleXLayout}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name || item.title}`}
          android_ripple={null}
          nextFocusDown={posterTag || undefined}
          style={[
            styles.removeButtonOverlay,
            { width: xButtonSize, height: xButtonSize, borderRadius: xButtonSize / 2 },
            xFocused && styles.removeButtonOverlayFocused,
          ]}
        >
          <Ionicons
            name="close"
            size={isTV ? 16 : 12}
            color={xFocused ? '#fff' : 'rgba(255,255,255,0.9)'}
          />
        </Pressable>
      </View>

      {/* Poster - pulled up to overlap X button */}
      <Pressable
        ref={posterRef}
        onPress={onPress}
        onFocus={handlePosterFocus}
        onBlur={handlePosterBlur}
        onLayout={handlePosterLayout}
        android_ripple={null}
        nextFocusUp={xButtonTag || undefined}
        {...focusTrapProps}
        style={[
          styles.posterContainer,
          { height: cardHeight, marginTop: -xRowHeight },
          isFocused && styles.posterFocused,
        ]}
      >
        <View style={styles.imageWrapper}>
          <Image
            source={{ uri: item.poster }}
            style={styles.posterImage}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>

        {!item.poster && (
          <View style={styles.placeholder}>
            <Ionicons
              name={item.type === 'series' ? 'tv-outline' : 'film-outline'}
              size={cardWidth * 0.4}
              color={colors.primaryDark}
            />
          </View>
        )}
      </Pressable>

      {/* Title */}
      <View style={styles.titleContainer}>
        <Text style={[styles.cardTitle, isTV && styles.cardTitleTV]} numberOfLines={2}>
          {item.name || item.title}
        </Text>
      </View>
    </View>
  );
});

export default function LibraryScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const { library, isLoadingLibrary, fetchLibrary, removeFromLibrary } = useContentStore();
  const [filter, setFilter] = useState<FilterType>('movies');
  const [refreshing, setRefreshing] = useState(false);

  const cardWidth = getCardWidth(width, isTV, 'medium');
  const cardHeight = cardWidth * 1.5;
  const itemTotalWidth = cardWidth + 16;
  const paddingLeft = isTV ? 48 : 16;

  // Track horizontal nav for scroll behavior
  const isNavigatingRef = useRef(false);
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flatListRef = useRef<FlatList>(null);
  const TV_SCROLL_ANCHOR = 4;

  useEffect(() => {
    fetchLibrary();
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchLibrary(true);
    setRefreshing(false);
  }, []);

  const handleItemPress = useCallback((item: ContentItem) => {
    const id = item.imdb_id || item.id;
    router.push(`/details/${item.type}/${id}`);
  }, [router]);

  const handleRemoveItem = useCallback((item: ContentItem) => {
    const contentId = item.imdb_id || item.id;
    const contentType = item.type || 'movie';
    const contentName = item.name || item.title || 'this item';

    Alert.alert(
      'Remove from Library?',
      `Remove "${contentName}" from your library?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeFromLibrary(contentType, contentId);
            } catch (error) {
              console.log('Remove error:', error);
            }
          },
        },
      ]
    );
  }, [removeFromLibrary]);

  const getFilteredContent = (): ContentItem[] => {
    if (!library) return [];
    switch (filter) {
      case 'movies': return library.movies || [];
      case 'series': return library.series || [];
      case 'tv': return library.channels || [];
      default: return library.movies || [];
    }
  };

  const filteredContent = getFilteredContent();

  const handleCardFocus = useCallback((index: number) => {
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    if (isTV && flatListRef.current && isNavigatingRef.current) {
      const targetOffset = Math.max(0, (index - TV_SCROLL_ANCHOR) * itemTotalWidth);
      flatListRef.current.scrollToOffset({ offset: targetOffset, animated: true });
    }
    isNavigatingRef.current = true;
  }, [itemTotalWidth, isTV]);

  const handleCardBlur = useCallback(() => {
    blurTimerRef.current = setTimeout(() => {
      isNavigatingRef.current = false;
    }, 150);
  }, []);

  const getItemLayout = useCallback((_data: any, index: number) => ({
    length: itemTotalWidth,
    offset: paddingLeft + (index * itemTotalWidth),
    index,
  }), [itemTotalWidth, paddingLeft]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <LibraryCard
      item={item}
      onPress={() => handleItemPress(item)}
      onRemove={() => handleRemoveItem(item)}
      cardWidth={cardWidth}
      cardHeight={cardHeight}
      isTV={isTV}
      isFirstInRow={index === 0}
      isLastInRow={index === filteredContent.length - 1}
      onCardBlur={handleCardBlur}
    />
  ), [handleItemPress, handleRemoveItem, cardWidth, cardHeight, isTV, filteredContent.length, handleCardBlur]);

  const renderFilterButton = (type: FilterType, label: string) => {
    const isActive = filter === type;
    return (
      <Pressable
        onPress={() => setFilter(type)}
        onFocus={() => {}}
        style={({ focused }) => [
          styles.filterButton,
          isActive && styles.filterButtonActive,
          focused && styles.filterButtonFocused,
        ]}
      >
        <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
          {label}
        </Text>
      </Pressable>
    );
  };

  if (isLoadingLibrary && !library) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>Library</Text>
      </View>

      <View style={[styles.filterContainer, isTV && styles.filterContainerTV]}>
        {renderFilterButton('movies', 'Movies')}
        {renderFilterButton('series', 'Series')}
        {renderFilterButton('tv', 'TV Channels')}
      </View>

      {filteredContent.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="bookmark-outline" size={64} color={colors.primaryDark} />
          <Text style={styles.emptyText}>Your library is empty</Text>
          <Text style={styles.emptySubtext}>Long press any poster to add to library</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          horizontal
          data={filteredContent}
          renderItem={renderItem}
          keyExtractor={(item) => item.imdb_id || item.id || item.name || ''}
          getItemLayout={getItemLayout}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={[styles.listContent, isTV && styles.listContentTV]}
          initialNumToRender={10}
          maxToRenderPerBatch={8}
          windowSize={5}
          removeClippedSubviews={true}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  headerTV: {
    paddingHorizontal: 48,
    paddingVertical: 16,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.primary,
  },
  headerTitleTV: {
    fontSize: 32,
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  filterContainerTV: {
    paddingHorizontal: 48,
    paddingVertical: 16,
    gap: 12,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  filterButtonActive: {
    backgroundColor: colors.primary,
  },
  filterButtonFocused: {
    borderColor: colors.primary,
  },
  filterText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  emptySubtext: {
    color: colors.primaryDark,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  listContent: {
    paddingLeft: 16,
    paddingRight: 48,
    paddingTop: 8,
  },
  listContentTV: {
    paddingLeft: 48,
    paddingRight: 128,
  },
  // X button row
  xButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    zIndex: 10,
  },
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
  // Poster
  posterContainer: {
    borderRadius: 6,
    overflow: 'visible',
    backgroundColor: '#1a1a1a',
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
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
  },
  titleContainer: {
    paddingTop: 6,
    paddingHorizontal: 2,
    height: 38,
  },
  cardTitle: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 16,
  },
  cardTitleTV: {
    fontSize: 13,
  },
});
