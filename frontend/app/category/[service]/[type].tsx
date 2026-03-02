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
  onPress 
}: { 
  item: ContentItem; 
  itemWidth: number; 
  itemHeight: number; 
  gap: number; 
  onPress: (item: ContentItem) => void;
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
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
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
// CategoryScreen
// ============================================
export default function CategoryScreen() {
  const { service, type } = useLocalSearchParams<{ service: string; type: string }>();
  const router = useRouter();
  const { discoverData } = useContentStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalLoaded, setTotalLoaded] = useState(0);
  const [backFocused, setBackFocused] = useState(false);
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

  // Grid sizing - Fire Stick reports ~960dp
  const numColumns = isTV ? Math.max(6, Math.floor(width / 140)) : 3;
  const horizontalPadding = isTV ? 24 : 16;
  const gap = isTV ? 12 : 8;
  const ITEM_WIDTH = (width - horizontalPadding * 2 - (numColumns - 1) * gap) / numColumns;
  const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

  const decodedService = service ? decodeURIComponent(service) : '';
  const initialLoadDone = useRef(false);

  // Fix duplicate title
  const typeLabel = type === 'movies' ? 'Movies' : type === 'series' ? 'Series' : 'Channels';
  const lowerService = decodedService.toLowerCase();
  const displayTitle = lowerService.includes(typeLabel.toLowerCase()) 
    ? decodedService 
    : `${decodedService} ${typeLabel}`;

  // Fetch a single page from the API
  const fetchPage = useCallback(async (skipValue: number): Promise<{ items: ContentItem[]; hasMore: boolean }> => {
    try {
      const response = await apiClient.get(
        `/api/content/category/${encodeURIComponent(decodedService)}/${type}?skip=${skipValue}&limit=100`
      );
      const data = response.data;
      const newItems = data.items || [];
      return { items: newItems, hasMore: newItems.length >= 20 };
    } catch (error) {
      console.log('Error fetching category page:', error);
      return { items: [], hasMore: false };
    }
  }, [decodedService, type]);

  // Load all content
  useEffect(() => {
    if (initialLoadDone.current || !decodedService || !type) return;
    initialLoadDone.current = true;

    const loadAll = async () => {
      setIsLoading(true);

      // Fetch first page and show it immediately
      const firstPage = await fetchPage(0);
      if (firstPage.items.length === 0 && discoverData) {
        // Fallback to cached discover data
        const serviceData = discoverData.services[decodedService];
        if (serviceData) {
          let fallback: ContentItem[] = [];
          if (type === 'movies') fallback = serviceData.movies || [];
          else if (type === 'series') fallback = serviceData.series || [];
          else if (type === 'channels') fallback = serviceData.channels || [];
          setItems(fallback.filter(Boolean));
        }
        setIsLoading(false);
        return;
      }

      setItems(firstPage.items);
      setTotalLoaded(firstPage.items.length);
      setIsLoading(false);

      // If there are more pages, fetch them in background (cap at 500 items total)
      if (firstPage.hasMore) {
        let allItems = [...firstPage.items];
        let currentSkip = firstPage.items.length;
        let hasMore = true;
        const MAX_ITEMS = 500;

        while (hasMore && allItems.length < MAX_ITEMS) {
          const page = await fetchPage(currentSkip);
          if (page.items.length > 0) {
            const existingIds = new Set(allItems.map(i => i.id || i.imdb_id));
            const unique = page.items.filter(i => !existingIds.has(i.id || i.imdb_id));
            allItems = [...allItems, ...unique];
            currentSkip += page.items.length;
            setTotalLoaded(allItems.length);
          }
          hasMore = page.hasMore && allItems.length < MAX_ITEMS;
        }

        // Single state update with all items
        setItems(allItems);
        setTotalLoaded(allItems.length);
      }
    };

    loadAll();
  }, [decodedService, type, fetchPage]);

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

  const renderItem = useCallback(({ item }: { item: ContentItem }) => (
    <CategoryItem
      item={item}
      itemWidth={ITEM_WIDTH}
      itemHeight={ITEM_HEIGHT}
      gap={gap}
      onPress={handleItemPress}
    />
  ), [ITEM_WIDTH, ITEM_HEIGHT, gap, handleItemPress]);

  const keyExtractor = useCallback((item: ContentItem) => item.id || item.imdb_id || '', []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Pressable 
          onPress={() => router.back()} 
          onFocus={() => setBackFocused(true)}
          onBlur={() => setBackFocused(false)}
          style={[styles.backButton, backFocused && styles.backButtonFocused]}
        >
          <Ionicons name="arrow-back" size={isTV ? 28 : 24} color={backFocused ? colors.primary : "#FFFFFF"} />
        </Pressable>
        <Text style={[styles.headerTitle, isTV && styles.headerTitleTV]}>
          {displayTitle} {totalLoaded > 0 ? `(${totalLoaded})` : ''}
        </Text>
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
          data={items}
          renderItem={renderItem}
          keyExtractor={keyExtractor}
          numColumns={numColumns}
          key={numColumns}
          contentContainerStyle={[styles.gridContent, { paddingHorizontal: horizontalPadding }]}
          showsVerticalScrollIndicator={false}
          initialNumToRender={numColumns * 4}
          maxToRenderPerBatch={numColumns * 3}
          removeClippedSubviews={false}
          windowSize={11}
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
    color: colors.textPrimary,
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
    borderWidth: 2,
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
    color: colors.textPrimary,
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  loadingText: {
    color: colors.textSecondary,
    marginTop: 12,
    fontSize: 14,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
});
