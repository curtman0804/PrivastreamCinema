import React, { useEffect, useState, useCallback } from 'react';
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

export default function CategoryScreen() {
  const { service, type } = useLocalSearchParams<{ service: string; type: string }>();
  const router = useRouter();
  const { discoverData } = useContentStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);
  const { width, height } = useWindowDimensions();
  const isTV = width > height || width > 800;

  // Calculate grid dimensions to match discover page poster sizes
  // Fire Stick reports ~960dp width, so use smaller divisor for more columns
  const numColumns = isTV ? Math.max(6, Math.floor(width / 140)) : 3;
  const horizontalPadding = isTV ? 24 : 16;
  const gap = isTV ? 12 : 8;
  const ITEM_WIDTH = (width - horizontalPadding * 2 - (numColumns - 1) * gap) / numColumns;
  const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

  const decodedService = service ? decodeURIComponent(service) : '';

  const isLoadingRef = React.useRef(false);
  const skipRef = React.useRef(0);
  const hasMoreRef = React.useRef(true);
  const initialLoadDone = React.useRef(false);

  const fetchCategoryContent = async (skipValue: number, append: boolean) => {
    if (!decodedService || !type) return;
    if (isLoadingRef.current) return; // Prevent duplicate calls
    
    isLoadingRef.current = true;
    
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      
      console.log(`Fetching category: ${decodedService}, skip=${skipValue}`);
      const response = await apiClient.get(`/api/content/category/${encodeURIComponent(decodedService)}/${type}?skip=${skipValue}&limit=100`);
      const data = response.data;
      
      const newItems = data.items || [];
      console.log(`Received ${newItems.length} items`);
      
      if (append && newItems.length > 0) {
        setItems(prev => {
          const existingIds = new Set(prev.map(item => item.id || item.imdb_id));
          const uniqueNewItems = newItems.filter((item: ContentItem) => !existingIds.has(item.id || item.imdb_id));
          return [...prev, ...uniqueNewItems];
        });
      } else if (!append) {
        setItems(newItems);
      }
      
      const moreAvailable = newItems.length >= 20;
      hasMoreRef.current = moreAvailable;
      setHasMore(moreAvailable);
      skipRef.current = skipValue + newItems.length;
      setSkip(skipRef.current);
    } catch (error) {
      console.log('Error fetching category:', error);
      if (!append && discoverData) {
        const serviceData = discoverData.services[decodedService];
        if (serviceData) {
          let categoryItems: ContentItem[] = [];
          if (type === 'movies') categoryItems = serviceData.movies || [];
          else if (type === 'series') categoryItems = serviceData.series || [];
          else if (type === 'channels') categoryItems = serviceData.channels || [];
          setItems(categoryItems.filter(Boolean));
          hasMoreRef.current = false;
          setHasMore(false);
        }
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
      isLoadingRef.current = false;
    }
  };

  useEffect(() => {
    if (!initialLoadDone.current && decodedService && type) {
      initialLoadDone.current = true;
      fetchCategoryContent(0, false);
    }
  }, [decodedService, type]);

  const handleLoadMore = useCallback(() => {
    if (isLoadingRef.current || !hasMoreRef.current) return;
    console.log(`Loading more from skip=${skipRef.current}`);
    fetchCategoryContent(skipRef.current, true);
  }, []);

  const handleItemPress = (item: ContentItem) => {
    const id = item.imdb_id || item.id;
    const encodedId = encodeURIComponent(id);
    router.push({
      pathname: `/details/${item.type}/${encodedId}`,
      params: {
        name: item.name || '',
        poster: item.poster || '',
      }
    });
  };

  const CategoryItem = ({ item }: { item: ContentItem }) => {
    const [focused, setFocused] = useState(false);
    return (
      <Pressable 
        style={[
          { width: ITEM_WIDTH, marginBottom: 16, marginHorizontal: gap / 2, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
          focused && { borderColor: colors.primary },
        ]}
        onPress={() => handleItemPress(item)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      >
        <Image
          source={{ uri: item.poster }}
          style={{ width: '100%', height: ITEM_HEIGHT, borderRadius: 6, backgroundColor: colors.backgroundLight }}
          contentFit="cover"
          placeholder={require('../../../assets/images/icon.png')}
          placeholderContentFit="contain"
        />
        <Text style={styles.itemTitle} numberOfLines={2}>{item.name}</Text>
      </Pressable>
    );
  };

  // Fix duplicate title: if service name already includes the type word, don't append it
  const typeLabel = type === 'movies' ? 'Movies' : type === 'series' ? 'Series' : 'Channels';
  const lowerService = decodedService.toLowerCase();
  const lowerType = typeLabel.toLowerCase();
  const displayTitle = lowerService.includes(lowerType) ? decodedService : `${decodedService} ${typeLabel}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, isTV && styles.headerTV]}>
        <Pressable onPress={() => router.back()} style={({ focused }) => [styles.backButton, focused && styles.backButtonFocused]}>
          <Ionicons name="arrow-back" size={isTV ? 28 : 24} color="#FFFFFF" />
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
          data={items}
          renderItem={({ item }) => <CategoryItem item={item} />}
          keyExtractor={(item) => item.id || item.imdb_id || Math.random().toString()}
          numColumns={numColumns}
          key={numColumns}
          contentContainerStyle={[styles.gridContent, { paddingHorizontal: horizontalPadding }]}
          showsVerticalScrollIndicator={false}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          removeClippedSubviews={false}
          windowSize={21}
          ListFooterComponent={
            isLoadingMore ? (
              <View style={styles.loadMoreContainer}>
                <ActivityIndicator size="small" color="#B8A05C" />
                <Text style={styles.loadMoreText}>Loading more... ({items.length} loaded)</Text>
              </View>
            ) : !hasMore && items.length > 0 ? (
              <View style={styles.footerContainer}>
                <Text style={styles.endText}>End of catalog ({items.length} items)</Text>
              </View>
            ) : null
          }
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
  loadMoreContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadMoreText: {
    color: colors.textSecondary,
    marginLeft: 10,
    fontSize: 14,
  },
  footerContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  endText: {
    color: colors.textSecondary,
    fontSize: 14,
  },
});
