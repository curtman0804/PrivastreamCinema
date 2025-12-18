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
import { ContentItem } from '../../../src/api/client';
import apiClient from '../../../src/api/client';

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
          keyExtractor={(item) => item.id || item.imdb_id || Math.random().toString()}
          numColumns={3}
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={true}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          initialNumToRender={30}
          maxToRenderPerBatch={20}
          updateCellsBatchingPeriod={100}
          windowSize={21}
          getItemLayout={(data, index) => ({
            length: ITEM_HEIGHT + 16 + 30, // poster height + margin + title
            offset: (ITEM_HEIGHT + 16 + 30) * Math.floor(index / 3),
            index,
          })}
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
  footerContainer: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  loadMoreButton: {
    backgroundColor: '#B8A05C',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  loadMoreButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: 14,
  },
  endText: {
    color: '#666',
    fontSize: 14,
  },
});
