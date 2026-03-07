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

// Library card — EXACT same X-button pattern as ContinueWatchingCard in discover.tsx
function LibraryCard({
  item,
  cardWidth,
  cardHeight,
  isTV,
  onPress,
  onRemove,
  onCardBlur,
}: {
  item: ContentItem;
  cardWidth: number;
  cardHeight: number;
  isTV: boolean;
  onPress: () => void;
  onRemove: () => void;
  onCardBlur?: () => void;
}) {
  const [isFocused, setIsFocused] = useState(false);
  const [xFocused, setXFocused] = useState(false);

  // Refs for explicit focus navigation between poster and X button
  const posterRef = useRef<View>(null);
  const xButtonRef = useRef<View>(null);
  const [posterTag, setPosterTag] = useState<number | undefined>(undefined);
  const [xButtonTag, setXButtonTag] = useState<number | undefined>(undefined);

  useEffect(() => {
    // Get native node handles after mount for nextFocusUp/Down wiring
    const pTag = posterRef.current ? findNodeHandle(posterRef.current) : null;
    const xTag = xButtonRef.current ? findNodeHandle(xButtonRef.current) : null;
    if (pTag) setPosterTag(pTag);
    if (xTag) setXButtonTag(xTag);
  }, []);

  const handleFocus = () => {
    setIsFocused(true);
  };

  const handleXFocus = () => {
    setXFocused(true);
  };

  const xButtonSize = isTV ? 30 : 24;
  const xRowHeight = xButtonSize + 8;

  return (
    <View style={{ width: cardWidth, marginRight: 16 }}>
      {/* X button row - in normal flow ABOVE poster, right-aligned, overlaps via negative margin */}
      <View style={[styles.xButtonRow, { paddingTop: 8 }]}>
        <Pressable
          ref={xButtonRef}
          onPress={onRemove}
          onFocus={handleXFocus}
          onBlur={() => setXFocused(false)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${item.name || item.title} from Library`}
          android_ripple={null}
          nextFocusDown={posterTag}
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

      {/* Main poster - pulled up fully to overlap X button row, so X appears inside poster corner */}
      <Pressable
        ref={posterRef}
        onPress={onPress}
        onFocus={handleFocus}
        onBlur={() => { setIsFocused(false); onCardBlur?.(); }}
        android_ripple={null}
        nextFocusUp={xButtonTag}
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

      {/* Title below poster */}
      <View style={styles.titleContainer}>
        <Text style={[styles.cardTitle, isTV && styles.cardTitleTV]} numberOfLines={2}>
          {item.name || item.title}
        </Text>
      </View>
    </View>
  );
}

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

  const handleRemoveItem = useCallback(async (item: ContentItem) => {
    const contentId = item.imdb_id || item.id;
    const contentType = item.type || 'movie';
    try {
      await removeFromLibrary(contentType, contentId);
    } catch (error) {
      console.log('Remove error:', error);
    }
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
      onPress={() => { handleCardFocus(index); handleItemPress(item); }}
      onRemove={() => handleRemoveItem(item)}
      cardWidth={cardWidth}
      cardHeight={cardHeight}
      isTV={isTV}
      onCardBlur={handleCardBlur}
    />
  ), [handleItemPress, handleRemoveItem, cardWidth, cardHeight, isTV, handleCardBlur, handleCardFocus]);

  const FilterButton = ({ type, label }: { type: FilterType; label: string }) => {
    const isActive = filter === type;
    const [btnFocused, setBtnFocused] = useState(false);
    return (
      <Pressable
        onPress={() => setFilter(type)}
        onFocus={() => setBtnFocused(true)}
        onBlur={() => setBtnFocused(false)}
        style={[
          styles.filterButton,
          isActive && styles.filterButtonActive,
          btnFocused && styles.filterButtonFocused,
        ]}
      >
        <Text style={[styles.filterText, isActive && styles.filterTextActive, btnFocused && styles.filterTextFocused]}>
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
        <FilterButton type="movies" label="Movies" />
        <FilterButton type="series" label="Series" />
        <FilterButton type="tv" label="TV Channels" />
      </View>

      {filteredContent.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Ionicons name="bookmark-outline" size={64} color={colors.primaryDark} />
          <Text style={styles.emptyText}>Your library is empty</Text>
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
    backgroundColor: 'rgba(184, 160, 92, 0.3)',
    transform: [{ scale: 1.1 }],
  },
  filterText: {
    color: '#888888',
    fontSize: 14,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#FFFFFF',
  },
  filterTextFocused: {
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
  // X button row - sits above poster, right-aligned (matches discover.tsx)
  xButtonRow: {
    alignItems: 'flex-end',
    zIndex: 10,
    paddingRight: 8,
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
