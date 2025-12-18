import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useContentStore } from '../../../src/store/contentStore';
import { ContentItem, api } from '../../../src/api/client';

const { width } = Dimensions.get('window');
const ITEM_WIDTH = (width - 48) / 3; // 3 columns with padding
const ITEM_HEIGHT = ITEM_WIDTH * 1.5;

export default function CategoryScreen() {
  const { service, type } = useLocalSearchParams<{ service: string; type: string }>();
  const router = useRouter();
  const { discoverData } = useContentStore();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [skip, setSkip] = useState(0);

  const decodedService = service ? decodeURIComponent(service) : '';

  const fetchCategoryContent = useCallback(async (skipValue: number = 0, append: boolean = false) => {
    if (!decodedService || !type) return;
    if (append && isLoadingMore) return; // Prevent duplicate calls
    
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      
      console.log(`Fetching category: ${decodedService}, skip=${skipValue}`);
      const response = await api.get(`/api/content/category/${encodeURIComponent(decodedService)}/${type}?skip=${skipValue}&limit=100`);
      const data = response.data;
      
      const newItems = data.items || [];
      console.log(`Received ${newItems.length} items, hasMore=${data.hasMore}`);
      
      if (append) {
        setItems(prev => {
          // Deduplicate items based on ID
          const existingIds = new Set(prev.map(item => item.id || item.imdb_id));
          const uniqueNewItems = newItems.filter((item: ContentItem) => !existingIds.has(item.id || item.imdb_id));
          return [...prev, ...uniqueNewItems];
        });
      } else {
        setItems(newItems);
      }
      
      // Keep loading if we got items (most Stremio addons have unlimited pagination)
      setHasMore(newItems.length > 0);
      setSkip(skipValue + newItems.length);
    } catch (error) {
      console.log('Error fetching category:', error);
      // Fallback to discover data
      if (!append && discoverData) {
        const serviceData = discoverData.services[decodedService];
        if (serviceData) {
          let categoryItems: ContentItem[] = [];
          if (type === 'movies') {
            categoryItems = serviceData.movies || [];
          } else if (type === 'series') {
            categoryItems = serviceData.series || [];
          } else if (type === 'channels') {
            categoryItems = serviceData.channels || [];
          }
          setItems(categoryItems.filter(Boolean));
          setHasMore(false);
        }
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [decodedService, type, discoverData, isLoadingMore]);

  useEffect(() => {
    fetchCategoryContent(0, false);
  }, [fetchCategoryContent]);

  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      fetchCategoryContent(skip, true);
    }
  }, [isLoadingMore, hasMore, skip, fetchCategoryContent]);

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

  const renderItem = ({ item }: { item: ContentItem }) => (
    <TouchableOpacity 
      style={styles.itemContainer}
      onPress={() => handleItemPress(item)}
      activeOpacity={0.7}
    >
      <Image
        source={{ uri: item.poster }}
        style={styles.poster}
        contentFit="cover"
        placeholder={require('../../../assets/images/icon.png')}
        placeholderContentFit="contain"
      />
      <Text style={styles.itemTitle} numberOfLines={2}>{item.name}</Text>
    </TouchableOpacity>
  );

  const typeLabel = type === 'movies' ? 'Movies' : type === 'series' ? 'Series' : 'Channels';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{decodedService} {typeLabel}</Text>
        <View style={styles.placeholder} />
      </View>

      {/* Content Grid */}
      {isLoading ? (
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color="#B8A05C" />
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
          keyExtractor={(item, index) => `${item.id || item.imdb_id || ''}-${index}`}
          numColumns={3}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={true}
          onEndReached={() => {
            console.log('onEndReached triggered, hasMore:', hasMore, 'isLoadingMore:', isLoadingMore);
            if (hasMore && !isLoadingMore) {
              handleLoadMore();
            }
          }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            <View style={styles.footerContainer}>
              {isLoadingMore ? (
                <View style={styles.loadMoreContainer}>
                  <ActivityIndicator size="small" color="#B8A05C" />
                  <Text style={styles.loadMoreText}>Loading more...</Text>
                </View>
              ) : hasMore ? (
                <TouchableOpacity style={styles.loadMoreButton} onPress={handleLoadMore}>
                  <Text style={styles.loadMoreButtonText}>Load More ({items.length} loaded)</Text>
                </TouchableOpacity>
              ) : (
                <Text style={styles.endText}>End of catalog ({items.length} items)</Text>
              )}
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f11',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1d',
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
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
    padding: 16,
  },
  itemContainer: {
    width: ITEM_WIDTH,
    marginBottom: 16,
    marginHorizontal: 4,
  },
  poster: {
    width: '100%',
    height: ITEM_HEIGHT,
    borderRadius: 8,
    backgroundColor: '#1a1a1d',
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 12,
    marginTop: 6,
    textAlign: 'center',
  },
  loadingText: {
    color: '#999',
    marginTop: 12,
    fontSize: 14,
  },
  emptyText: {
    color: '#666',
    fontSize: 16,
  },
  loadMoreContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
  },
  loadMoreText: {
    color: '#999',
    marginLeft: 10,
    fontSize: 14,
  },
});
