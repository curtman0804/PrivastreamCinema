import React, { useEffect, useState, useCallback, useRef, memo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  findNodeHandle,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useContentStore } from '../../../src/store/contentStore';
import { ContentItem } from '../../../src/api/client';
import apiClient from '../../../src/api/client';
import colors from '../../../src/styles/colors';

// ============================================
// CategoryItem - MUST be outside the screen component
// so FlatList can properly diff and reuse cells
// ============================================
const CategoryItem = memo(({ 
  item, 
  itemWidth, 
  itemHeight, 
  gap, 
  onPress,
  onFocusItem,
}: { 
  item: ContentItem; 
  itemWidth: number; 
  itemHeight: number; 
  gap: number; 
  onPress: (item: ContentItem) => void;
  onFocusItem?: () => void;
}) => {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      style={[
        styles.gridItem,
        { width: itemWidth, marginHorizontal: gap / 2 },
        focused && styles.gridItemFocused,
      ]}
      onPress={() => onPress(item)}
      onFocus={() => {
        setFocused(true);
        onFocusItem?.();
      }}
      onBlur={() => setFocused(false)}
      android_ripple={null}
    >
      <Image
        source={{ uri: item.poster }}
        style={[styles.gridPoster, { height: itemHeight }]}
        contentFit="cover"
        recyclingKey={item.id || item.imdb_id}
      />
      <Text style={styles.itemTitle} numberOfLines={2}>{item.name}</Text>
    </Pressable>
  );
});

// ============================================
// CategoryScreen - Infinite scroll pagination
// ============================================
export default function CategoryScreen() {
  const { service, type } = useLocalSearchParams<{ service: string; type: string }>();
  const router = useRouter();
  const { discoverData } = useContentStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [backFocused, setBackFocused] = useState(false);
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;
  const flatListRef = useRef<FlatList>(null);

  // Refs to prevent stale closures in callbacks
  const skipRef = useRef(0);
  const isLoadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const initialLoadDone = useRef(false);

  // Grid sizing - Fire Stick reports ~960dp
  const numColumns = isTV ? Math.max(6, Math.floor(width / 140)) : 3;
  const horizontalPadding = isTV ? 24 : 16;
  const gap = isTV ? 12 : 8;
  const ITEM_WIDTH = (width - horizontalPadding * 2 - (numColumns - 1) * gap) / numColumns;
  const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

  const decodedService = service ? decodeURIComponent(service) : '';

  // Fix duplicate title
  const typeLabel = type === 'movies' ? 'Movies' : type === 'series' ? 'Series' : 'Channels';
  const lowerService = decodedService.toLowerCase();
  const displayTitle = lowerService.includes(typeLabel.toLowerCase()) 
    ? decodedService 
    : `${decodedService} ${typeLabel}`;

  // Fetch one page of content
  const fetchOnePage = useCallback(async (isFirstPage: boolean) => {
    if (!decodedService || !type) return;
    if (isLoadingRef.current) return;
    if (!hasMoreRef.current && !isFirstPage) return;

    isLoadingRef.current = true;
    if (isFirstPage) {
      setIsLoading(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      const currentSkip = isFirstPage ? 0 : skipRef.current;
      const response = await apiClient.get(
        `/api/content/category/${encodeURIComponent(decodedService)}/${type}?skip=${currentSkip}&limit=100`
      );
      const data = response.data;
      const newItems: ContentItem[] = data.items || [];

      if (newItems.length > 0) {
        if (isFirstPage) {
          setItems(newItems);
          skipRef.current = newItems.length;
        } else {
          setItems(prev => {
            const existingIds = new Set(prev.map(i => i.id || i.imdb_id));
            const unique = newItems.filter(i => !existingIds.has(i.id || i.imdb_id));
            skipRef.current = currentSkip + newItems.length;
            return [...prev, ...unique];
          });
        }
      }

      // If API returned hasMore field, use it; otherwise check if we got enough items
      const moreAvailable = data.hasMore !== undefined ? data.hasMore : newItems.length >= 20;
      hasMoreRef.current = moreAvailable;
      setHasMore(moreAvailable);
    } catch (error) {
      console.log('Error fetching category:', error);
      // Fallback to cached discover data on first page
      if (isFirstPage && discoverData) {
        const serviceData = discoverData.services[decodedService];
        if (serviceData) {
          let fallback: ContentItem[] = [];
          if (type === 'movies') fallback = serviceData.movies || [];
          else if (type === 'series') fallback = serviceData.series || [];
          else if (type === 'channels') fallback = serviceData.channels || [];
          setItems(fallback.filter(Boolean));
        }
      }
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      isLoadingRef.current = false;
    }
  }, [decodedService, type, discoverData]);

  // Initial load
  useEffect(() => {
    if (!initialLoadDone.current && decodedService && type) {
      initialLoadDone.current = true;
      fetchOnePage(true);
    }
  }, [decodedService, type, fetchOnePage]);

  // Load more when user scrolls to bottom
  const handleLoadMore = useCallback(() => {
    if (!isLoadingRef.current && hasMoreRef.current) {
      fetchOnePage(false);
    }
  }, [fetchOnePage]);

  const handleItemPress = useCallback((item: ContentItem) => {
    const id = item.imdb_id || item.id;
    const encodedId = encodeURIComponent(id);
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      }
    });
  }, [router]);

  // Auto-scroll when a poster is focused so it's visible
  const handleItemFocus = useCallback((index: number) => {
    const rowIndex = Math.floor(index / numColumns);
    // Scroll to the row so the focused item is visible
    if (flatListRef.current) {
      const rowHeight = ITEM_HEIGHT + 40; // poster + title + margin
      flatListRef.current.scrollToOffset({
        offset: Math.max(0, rowIndex * rowHeight - 60), // 60px offset for header
        animated: true,
      });
    }
  }, [numColumns, ITEM_HEIGHT]);

  const renderItem = useCallback(({ item, index }: { item: ContentItem; index: number }) => (
    <CategoryItem
      item={item}
      itemWidth={ITEM_WIDTH}
      itemHeight={ITEM_HEIGHT}
      gap={gap}
      onPress={handleItemPress}
      onFocusItem={() => handleItemFocus(index)}
    />
  ), [ITEM_WIDTH, ITEM_HEIGHT, gap, handleItemPress, handleItemFocus]);

  const keyExtractor = useCallback((item: ContentItem) => item.id || item.imdb_id || '', []);

  const LoadMoreFooter = () => {
    if (isLoadingMore) {
      return (
        <View style={styles.footerContainer}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={styles.footerText}>Loading more... ({items.length} loaded)</Text>
        </View>
      );
    }
    if (!hasMore && items.length > 0) {
      return (
        <View style={styles.footerContainer}>
          <Text style={styles.footerText}>All {items.length} items loaded</Text>
        </View>
      );
    }
    return null;
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Pressable 
          onPress={() => router.back()} 
          onFocus={() => setBackFocused(true)}
          onBlur={() => setBackFocused(false)}
          android_ripple={null}
          style={[styles.backButton, backFocused && styles.backButtonFocused]}
        >
          <Ionicons name="arrow-back" size={isTV ? 28 : 24} color={backFocused ? colors.primary : "#FFFFFF"} />
        </Pressable>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>{displayTitle}</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content Grid */}
      {isLoading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading {decodedService}...</Text>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No content found</Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={numColumns}
          key={numColumns}
          contentContainerStyle={[styles.gridContent, { paddingHorizontal: horizontalPadding }]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={2.0}
          initialNumToRender={numColumns * 4}
          maxToRenderPerBatch={numColumns * 3}
          removeClippedSubviews={false}
          windowSize={15}
          ListFooterComponent={LoadMoreFooter}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.backgroundLight,
  },
  headerTV: {
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  backButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  backButtonFocused: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(184, 160, 92, 0.15)',
  },
  headerTitle: {
    color: colors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  headerTitleTV: {
    fontSize: 24,
  },
  placeholder: {
    width: 40,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  gridContent: {
    paddingVertical: 16,
  },
  gridItem: {
    marginBottom: 16,
    borderRadius: 8,
    borderWidth: 3,
    borderColor: 'transparent',
  },
  gridItemFocused: {
    borderColor: colors.primary,
  },
  gridPoster: {
    width: '100%',
    borderRadius: 6,
    backgroundColor: colors.backgroundLight,
  },
  itemTitle: {
    color: colors.primary,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  loadingText: {
    color: colors.primaryDark,
    marginTop: 12,
    fontSize: 14,
  },
  emptyText: {
    color: colors.primaryDark,
    fontSize: 16,
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  footerText: {
    color: colors.primaryDark,
    fontSize: 14,
  },
});
